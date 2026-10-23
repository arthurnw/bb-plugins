// Assumes the BB server and the dev servers run on the same machine: the
// plugin runs `lsof` and `tailscale` locally from the server process.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { OPEN_CHANNEL, type OpenPayload } from "./shared";

const execFileAsync = promisify(execFile);

// The server process may not inherit a login shell PATH.
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/bin"];

export const rpcContract = defineRpcContract({
  expose_local_url: {
    input: z.object({ url: z.string().url() }),
    output: z.object({ url: z.string() }),
  },
  claim_pending: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ urls: z.array(z.string()) }),
  },
});

type Listener = { port: number; address: string; command: string; pid: number };
type ServeEntry = { port: number; proxy: string };

const portSchema = z.coerce.number().int().min(1).max(65535);

function urlPort(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

/** Port a serve entry proxies to; -1 for non-proxy handlers. */
function upstreamPort(proxy: string): number {
  const url = URL.parse(proxy);
  return url ? urlPort(url) : -1;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    tailscalePath: {
      type: "string",
      label: "tailscale binary",
      description: "Command or absolute path used to run the Tailscale CLI.",
      default: "tailscale",
    },
  });
  const { tailscalePath } = await settings.get();

  async function run(file: string, args: string[]): Promise<string> {
    const PATH = [process.env.PATH ?? "", ...EXTRA_PATH].filter(Boolean).join(":");
    try {
      const { stdout } = await execFileAsync(file, args, {
        env: { ...process.env, PATH },
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const err = error as Error & { stderr?: string; code?: unknown };
      // lsof exits 1 when nothing matches.
      if (file === "lsof" && err.code === 1) return "";
      const detail = err.stderr?.trim() || err.message;
      throw new PluginCliError(`${file} ${args.join(" ")} failed: ${detail}`, {
        code: "command_failed",
      });
    }
  }

  const tailscale = (args: string[]) => run(tailscalePath, args);

  async function tailnetHost(): Promise<string> {
    const status = JSON.parse(await tailscale(["status", "--json"])) as {
      Self?: { DNSName?: string };
    };
    const name = status.Self?.DNSName?.replace(/\.$/, "");
    if (!name) {
      throw new PluginCliError("Tailscale did not report a MagicDNS name for this machine.", {
        code: "no_magicdns",
        hint: "Enable MagicDNS and HTTPS certificates for the tailnet.",
      });
    }
    return name;
  }

  async function listListeners(): Promise<Listener[]> {
    // -F pcn: one field per line, p=pid, c=command, n=address:port.
    const out = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]);
    // Keyed to drop duplicate rows for the same socket.
    const listeners = new Map<string, Listener>();
    let pid = 0;
    let command = "";
    for (const line of out.split("\n")) {
      const tag = line[0];
      const value = line.slice(1);
      if (tag === "p") pid = Number(value);
      else if (tag === "c") command = value;
      else if (tag === "n") {
        const index = value.lastIndexOf(":");
        const port = Number(value.slice(index + 1));
        const address = value.slice(0, index);
        if (port > 0) listeners.set(`${pid}:${value}`, { port, address, command, pid });
      }
    }
    return [...listeners.values()].sort((a, b) => a.port - b.port);
  }

  async function serveEntries(): Promise<ServeEntry[]> {
    const raw = (await tailscale(["serve", "status", "--json"])).trim();
    const status = JSON.parse(raw || "{}") as {
      Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
    };
    return Object.entries(status.Web ?? {})
      .map(([hostPort, web]) => ({
        port: Number(hostPort.slice(hostPort.lastIndexOf(":") + 1)),
        proxy: web.Handlers?.["/"]?.Proxy ?? "(non-proxy handler)",
      }))
      .sort((a, b) => a.port - b.port);
  }

  async function managedPorts(): Promise<number[]> {
    return (await bb.storage.kv.get<number[]>("managedPorts")) ?? [];
  }
  async function setManagedPorts(ports: number[]): Promise<void> {
    await bb.storage.kv.set("managedPorts", [...new Set(ports)].sort((a, b) => a - b));
  }

  const snapshot = () => Promise.all([tailnetHost(), listListeners(), serveEntries(), managedPorts()]);

  /** Pick the loopback address tailscale should proxy to for a listener. */
  function proxyTarget(port: number, listeners: Listener[]): string {
    const addresses = listeners.filter((l) => l.port === port).map((l) => l.address);
    if (addresses.length === 0) {
      throw new PluginCliError(`Nothing is listening on port ${port} on this machine.`, {
        code: "port_not_listening",
        hint: "Start the dev server first, or run `bb preview list` to see listening ports.",
      });
    }
    const ipv4 = addresses.some((a) => a === "127.0.0.1" || a === "*" || a === "0.0.0.0");
    // Vite and other Node servers bound to "localhost" often listen on ::1 only.
    return ipv4 ? `http://127.0.0.1:${port}` : `http://[::1]:${port}`;
  }

  async function expose(port: number): Promise<string> {
    const [host, listeners, entries, managed] = await snapshot();
    const target = proxyTarget(port, listeners);
    const existing = entries.find((e) => e.port === port);
    if (existing && existing.proxy !== target && !managed.includes(port)) {
      throw new PluginCliError(
        `Tailscale already serves port ${port} for ${existing.proxy}, which this plugin did not create.`,
        { code: "port_in_use", hint: "Run `tailscale serve status` to inspect it." },
      );
    }
    if (existing?.proxy !== target) {
      await tailscale(["serve", "--bg", "--yes", `--https=${port}`, target]);
      await setManagedPorts([...managed, port]);
      bb.log.info(`serving ${target} at https://${host}:${port}`);
    }
    return `https://${host}:${port}`;
  }

  async function stop(port: number, force: boolean): Promise<void> {
    const managed = await managedPorts();
    if (!managed.includes(port) && !force) {
      throw new PluginCliError(`Port ${port} was not published by this plugin.`, {
        code: "not_managed",
        hint: "Add --force to remove it anyway.",
      });
    }
    await tailscale(["serve", `--https=${port}`, "off"]);
    await setManagedPorts(managed.filter((p) => p !== port));
  }

  // URLs requested by a thread wait here until a client showing that thread
  // claims them, so a thread that is off screen gets its tab when next opened.
  // Calls are serialized so two clients cannot claim the same URL.
  let pendingLock: Promise<unknown> = Promise.resolve();
  function updatePending<T>(change: (pending: Record<string, string[]>) => T): Promise<T> {
    const next = pendingLock.then(async () => {
      const pending = (await bb.storage.kv.get<Record<string, string[]>>("pendingOpens")) ?? {};
      const result = change(pending);
      await bb.storage.kv.set("pendingOpens", pending);
      return result;
    });
    pendingLock = next.catch(() => undefined);
    return next;
  }

  async function publishOpen(url: string, threadId: string | undefined): Promise<void> {
    if (threadId) {
      await updatePending((pending) => {
        const urls = pending[threadId] ?? [];
        if (!urls.includes(url)) pending[threadId] = [...urls, url];
      });
    }
    const payload: OpenPayload = { id: randomUUID(), url, threadId: threadId ?? null };
    bb.realtime.publish(OPEN_CHANNEL, payload);
  }

  function openedMessage(threadId: string | undefined): string {
    return threadId
      ? "Queued for this thread's BB browser panel: it opens now if the thread is on screen, otherwise the next time the user opens the thread."
      : "Sent to the BB in-app Browser.";
  }

  function withPath(base: string, path: string | undefined): string {
    if (!path) return `${base}/`;
    return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  function parsePort(value: string): number {
    const parsed = portSchema.safeParse(value);
    if (!parsed.success) {
      throw new PluginCliError(`"${value}" is not a port number.`, { code: "invalid_port" });
    }
    return parsed.data;
  }

  bb.rpc.register(rpcContract, {
    // Rewrites a client-side localhost URL to the published tailnet URL.
    expose_local_url: async ({ url }) => {
      const parsed = new URL(url);
      const base = await expose(urlPort(parsed));
      return { url: `${base}${parsed.pathname}${parsed.search}${parsed.hash}` };
    },
    claim_pending: ({ threadId }) =>
      updatePending((pending) => {
        const urls = pending[threadId] ?? [];
        delete pending[threadId];
        return { urls };
      }),
  });

  bb.cli.register(
    defineCli({
      name: "preview",
      summary: "Publish a dev server on this machine over Tailscale and open it in the BB browser",
      commands: {
        open: cliCommand({
          summary: "Publish a listening port over tailscale serve and open it in the connected BB clients",
          positionals: [{ name: "port", description: "Local port the dev server listens on", required: true }],
          options: {
            path: { type: "string", description: "Path to open, for example /admin" },
            "no-open": { type: "boolean", description: "Only publish and print the URL" },
            json: { type: "boolean", description: "Emit machine-readable JSON" },
          },
          async run(input, ctx) {
            const port = parsePort(input.positionals.port);
            const url = withPath(await expose(port), input.options.path);
            const opened = !input.options["no-open"];
            if (opened) await publishOpen(url, ctx.threadId);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ url, port, opened })
                : `${url}\n${opened ? openedMessage(ctx.threadId) : "Published (not opened)."}`,
            };
          },
        }),
        url: cliCommand({
          summary: "Open any tailnet-reachable URL in the connected BB clients",
          positionals: [{ name: "url", description: "HTTP(S) URL", required: true }],
          async run(input, ctx) {
            const url = input.positionals.url;
            const parsed = URL.parse(url);
            if (!parsed || !/^https?:$/.test(parsed.protocol)) {
              throw new PluginCliError("Expected an http(s) URL.", { code: "invalid_url" });
            }
            await publishOpen(url, ctx.threadId);
            return { exitCode: 0, stdout: `${url}\n${openedMessage(ctx.threadId)}` };
          },
        }),
        list: cliCommand({
          summary: "List published ports and local TCP listeners",
          options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
          async run(input) {
            const [host, listeners, entries, managed] = await snapshot();
            const listening = new Set(listeners.map((l) => l.port));
            const served = entries.map((e) => ({
              ...e,
              url: e.port === 443 ? `https://${host}/` : `https://${host}:${e.port}/`,
              managed: managed.includes(e.port),
              upstreamListening: listening.has(upstreamPort(e.proxy)),
            }));
            if (input.options.json) {
              return { exitCode: 0, stdout: JSON.stringify({ host, served, listeners }) };
            }
            const lines = ["Published:"];
            for (const s of served) {
              const flags = [s.managed ? "preview" : "external", s.upstreamListening ? "" : "upstream down"]
                .filter(Boolean)
                .join(", ");
              lines.push(`  ${s.url}  -> ${s.proxy}  (${flags})`);
            }
            if (served.length === 0) lines.push("  (none)");
            lines.push("", "Listening on this machine:");
            for (const l of listeners) lines.push(`  ${String(l.port).padEnd(6)} ${l.address.padEnd(12)} ${l.command} (pid ${l.pid})`);
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        stop: cliCommand({
          summary: "Stop publishing a port (only ports this plugin published, unless --force)",
          positionals: [{ name: "port", description: "Published port", required: false }],
          options: {
            all: { type: "boolean", description: "Stop every port this plugin published" },
            force: { type: "boolean", description: "Also remove a serve entry this plugin did not create" },
          },
          async run(input) {
            const ports = input.options.all
              ? await managedPorts()
              : input.positionals.port
                ? [parsePort(input.positionals.port)]
                : null;
            if (ports === null) {
              throw new PluginCliError("Pass a port or --all.", { code: "missing_port" });
            }
            for (const port of ports) await stop(port, input.options.force === true);
            return {
              exitCode: 0,
              stdout: ports.length === 0 ? "Nothing to stop." : `Stopped ${ports.join(", ")}.`,
            };
          },
        }),
      },
    }),
  );
}
