// Assumes the BB server runs on the same machine as Plannotator: the plugin
// runs the `plannotator` CLI and reads its Inbox state file locally.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// The server process may not inherit a login shell PATH; the Plannotator
// installer puts the binary in ~/.local/bin.
const EXTRA_PATH = [join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

const inboxSchema = z.object({
  url: z.string(),
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

// Only the fields the page shows; inbox.json also holds an auth token.
const stateSchema = z.object({
  port: z.number().optional(),
  version: z.string().optional(),
  startedAt: z.string().optional(),
});

function dataDir(): string {
  return process.env.PLANNOTATOR_DATA_DIR ?? join(homedir(), ".plannotator");
}

async function readState(): Promise<z.infer<typeof stateSchema> | null> {
  try {
    const raw = await readFile(join(dataDir(), "inbox", "inbox.json"), "utf8");
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    plannotatorPath: {
      type: "string",
      label: "plannotator binary",
      description: "Command or absolute path used to run the Plannotator CLI.",
      default: "plannotator",
    },
  });
  const { plannotatorPath } = await settings.get();

  /** Starts the Inbox if it is stopped and returns its current URL. */
  async function ensureInbox(): Promise<InboxInfo> {
    const PATH = [process.env.PATH ?? "", ...EXTRA_PATH].filter(Boolean).join(":");
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(plannotatorPath, ["inbox", "--background"], {
        env: { ...process.env, PATH },
        timeout: 20_000,
      }));
    } catch (error) {
      const err = error as Error & { stderr?: string };
      const detail = err.stderr?.trim() || err.message;
      bb.log.warn(`plannotator inbox --background failed: ${detail}`);
      throw new Error(`Could not start the Plannotator Inbox: ${detail}`);
    }
    const url = stdout.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Error(`plannotator inbox --background printed no URL: ${stdout.trim()}`);
    const state = await readState();
    return {
      url,
      port: state?.port ?? null,
      version: state?.version ?? null,
      startedAt: state?.startedAt ?? null,
    };
  }

  bb.rpc.register(rpcContract, {
    inbox_ensure: () => ensureInbox(),
  });
}
