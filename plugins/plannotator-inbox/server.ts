// Assumes the BB server runs on the same machine as Plannotator: the plugin
// runs the `plannotator` and `tailscale` CLIs and reads the Inbox state file
// locally.
//
// The Inbox refuses to be framed (X-Frame-Options: DENY, frame-ancestors
// 'none'), so the page could only open it in BB's side panel. To show it in the
// page itself, a loopback proxy forwards to the Inbox and relaxes only those two
// headers. Requests that arrive over the tailnet are forwarded to the Inbox's
// own tailnet listener, so its Tailscale login check still applies.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// The server process may not inherit a login shell PATH; the Plannotator
// installer puts the binary in ~/.local/bin.
const EXTRA_PATH = [join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
const PATH = [process.env.PATH ?? "", ...EXTRA_PATH].filter(Boolean).join(":");

const inboxSchema = z.object({
  /** The address to open in a browser: the tailnet address when published, else the local one. */
  url: z.string(),
  localUrl: z.string(),
  tailnetUrl: z.string().nullable(),
  /** Frameable addresses served by this plugin's proxy. */
  frameLocalUrl: z.string(),
  frameTailnetUrl: z.string().nullable(),
  port: z.number().nullable(),
  version: z.string().nullable(),
  startedAt: z.string().nullable(),
});
export type InboxInfo = z.infer<typeof inboxSchema>;

export const rpcContract = defineRpcContract({
  inbox_ensure: {
    input: z.null(),
    output: inboxSchema,
  },
});

// Only the fields the plugin uses; inbox.json also holds an auth token.
const stateSchema = z.object({
  port: z.number().optional(),
  version: z.string().optional(),
  startedAt: z.string().optional(),
  tailscale: z
    .object({ url: z.string().nullable().optional(), proxy_port: z.number().nullable().optional() })
    .nullable()
    .optional(),
});
type InboxState = z.infer<typeof stateSchema>;

function dataDir(): string {
  return process.env.PLANNOTATOR_DATA_DIR ?? join(homedir(), ".plannotator");
}

async function readState(): Promise<InboxState | null> {
  try {
    const raw = await readFile(join(dataDir(), "inbox", "inbox.json"), "utf8");
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Relaxes only the framing rules of an Inbox response. */
function frameableHeaders(headers: IncomingHttpHeaders, frameAncestors: string): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = { ...headers };
  delete out["x-frame-options"];
  const csp = out["content-security-policy"];
  if (typeof csp === "string") {
    out["content-security-policy"] = csp.replace(/frame-ancestors[^;]*/, `frame-ancestors ${frameAncestors}`);
  }
  return out;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    plannotatorPath: {
      type: "string",
      label: "plannotator binary",
      description: "Command or absolute path used to run the Plannotator CLI.",
      default: "plannotator",
    },
    tailscalePath: {
      type: "string",
      label: "tailscale binary",
      description: "Command or absolute path used to run the Tailscale CLI.",
      default: "tailscale",
    },
    framePort: {
      type: "number",
      label: "Proxy port",
      description:
        "Port of the loopback proxy that lets the page show the Inbox. When the Inbox is on your tailnet, the same port is published there.",
      experimental_schema: z.number().int().min(1024).max(65535),
      default: 19450,
    },
  });
  const { plannotatorPath, tailscalePath, framePort } = await settings.get();
  const env = { ...process.env, PATH };

  let tailnetHost: string | null = null;
  let tailnetPublished = false;

  async function publishOnTailnet(): Promise<void> {
    const state = await readState();
    const url = state?.tailscale?.url;
    if (!url) return;
    tailnetHost = new URL(url).hostname;
    try {
      await execFileAsync(
        tailscalePath,
        ["serve", "--bg", `--https=${framePort}`, `http://127.0.0.1:${framePort}`],
        { env, timeout: 20_000 },
      );
      tailnetPublished = true;
    } catch (error) {
      const err = error as Error & { stderr?: string };
      bb.log.warn(`tailscale serve failed: ${err.stderr?.trim() || err.message}`);
    }
  }

  async function unpublish(): Promise<void> {
    if (!tailnetPublished) return;
    tailnetPublished = false;
    await execFileAsync(tailscalePath, ["serve", `--https=${framePort}`, "off"], { env, timeout: 20_000 }).catch(
      (error: Error) => bb.log.warn(`tailscale serve off failed: ${error.message}`),
    );
  }

  /** Origins the proxy itself is reached at; only these may send requests with an Origin header. */
  function proxyOrigins(): string[] {
    const origins = [`http://127.0.0.1:${framePort}`, `http://localhost:${framePort}`];
    if (tailnetHost) origins.push(`https://${tailnetHost}:${framePort}`);
    return origins;
  }

  function frameAncestors(): string {
    const list = ["'self'", "http://localhost:*", "http://127.0.0.1:*"];
    if (tailnetHost) list.push(`https://${tailnetHost}`, `https://${tailnetHost}:*`);
    return list.join(" ");
  }

  const proxy = createServer(async (req, res) => {
    const state = await readState();
    // tailscale serve sets this header and drops any copy the client sent.
    const viaTailnet = typeof req.headers["tailscale-user-login"] === "string";
    const tailnetUrl = state?.tailscale?.url ? new URL(state.tailscale.url) : null;
    const tailnetPort = state?.tailscale?.proxy_port ?? null;

    let upstreamPort: number;
    let upstreamOrigin: string;
    if (viaTailnet) {
      if (!tailnetUrl || !tailnetPort) {
        res.writeHead(503, { "content-type": "text/plain" }).end("The Plannotator Inbox is not published on the tailnet.");
        return;
      }
      upstreamPort = tailnetPort;
      upstreamOrigin = tailnetUrl.origin;
    } else {
      if (!state?.port) {
        res.writeHead(503, { "content-type": "text/plain" }).end("The Plannotator Inbox is not running.");
        return;
      }
      upstreamPort = state.port;
      upstreamOrigin = `http://127.0.0.1:${state.port}`;
    }

    const headers: IncomingHttpHeaders = { ...req.headers, host: new URL(upstreamOrigin).host };
    const origin = req.headers.origin;
    if (typeof origin === "string") {
      // Keep the Inbox's same-origin check meaningful: only the framed page may write.
      if (!proxyOrigins().includes(origin)) {
        res.writeHead(403, { "content-type": "text/plain" }).end("Origin not allowed.");
        return;
      }
      headers.origin = upstreamOrigin;
    }
    const referer = req.headers.referer;
    if (typeof referer === "string") {
      const match = proxyOrigins().find((o) => referer.startsWith(o));
      if (match) headers.referer = upstreamOrigin + referer.slice(match.length);
    }

    const upstream = httpRequest(
      { host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, frameableHeaders(upstreamRes.headers, frameAncestors()));
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Could not reach the Plannotator Inbox: ${error.message}`);
    });
    req.pipe(upstream);
  });

  bb.background.service("frame-proxy", {
    async start(signal) {
      await new Promise<void>((resolve, reject) => {
        proxy.once("error", reject);
        proxy.listen(framePort, "127.0.0.1", () => {
          proxy.off("error", reject);
          resolve();
        });
      });
      await publishOnTailnet();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      await unpublish();
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    },
  });

  /** Starts the Inbox if it is stopped and returns its current addresses. */
  async function ensureInbox(): Promise<InboxInfo> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(plannotatorPath, ["inbox", "--background"], { env, timeout: 20_000 }));
    } catch (error) {
      const err = error as Error & { stderr?: string };
      const detail = err.stderr?.trim() || err.message;
      bb.log.warn(`plannotator inbox --background failed: ${detail}`);
      throw new Error(`Could not start the Plannotator Inbox: ${detail}`);
    }
    // Output: an optional "Over your tailnet: https://…" line, then the local URL.
    const tailnetFromStdout = stdout.match(/Over your tailnet:\s*(https:\/\/\S+)/)?.[1] ?? null;
    const localUrl = stdout.match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/)?.[0];
    if (!localUrl) throw new Error(`plannotator inbox --background printed no URL: ${stdout.trim()}`);
    const state = await readState();
    const tailnetUrl = state?.tailscale?.url ?? tailnetFromStdout;
    // The Inbox may have been published after the proxy started.
    if (tailnetUrl && !tailnetPublished) await publishOnTailnet();
    return {
      url: tailnetUrl ?? localUrl,
      localUrl,
      tailnetUrl,
      frameLocalUrl: `http://127.0.0.1:${framePort}/`,
      frameTailnetUrl: tailnetPublished && tailnetHost ? `https://${tailnetHost}:${framePort}/` : null,
      port: state?.port ?? null,
      version: state?.version ?? null,
      startedAt: state?.startedAt ?? null,
    };
  }

  bb.rpc.register(rpcContract, {
    inbox_ensure: () => ensureInbox(),
  });
}
