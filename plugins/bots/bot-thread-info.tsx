// The thread Info tab: which bot a thread runs as, and what the bot adds to its instructions.
import {
  experimental_DetailRow as DetailRow,
  experimental_InfoSection as InfoSection,
  experimental_THREAD_INFO_ROW_GROUPS as ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS as SECTION_GROUPS,
  useRealtime, useRpc, useSdk, type PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { botsContract } from "./bots-server";
import { BotAvatar, useBots, useBotStates } from "./bot-avatars";
import { sendThreadToBot } from "./bots-view";

type ThreadBot = { botId: string | null; source: "own" | "inherited" | "none" | "detached"; instructions: string | null };
type ThreadFacts = { id: string; projectId: string; status: string };

function useThreadBot(threadId: string) {
  const rpc = useRpc<typeof botsContract>();
  const sdk = useSdk();
  const [state, setState] = useState<ThreadBot | null>(null);
  // Archived threads are not in the sidebar's live list, so read the thread itself.
  const [thread, setThread] = useState<ThreadFacts | null>(null);
  const load = () => {
    rpc.call("threadBot", { threadId }).then(setState, () => setState(null));
    sdk.threads.get({ threadId }).then((t) => setThread({ id: t.id, projectId: t.projectId, status: t.status }), () => setThread(null));
  };
  useEffect(load, [rpc, sdk, threadId]);
  useRealtime("bots", load);
  return { rpc, state, thread };
}

const NONE = "";

function BotRow({ threadId }: { threadId: string }) {
  const { rpc, state, thread } = useThreadBot(threadId);
  const bots = useBots();
  const botStates = useBotStates();
  if (!state || !bots || bots.length === 0 || !thread) return null;
  const bot = bots.find((item) => item.id === state.botId) ?? null;
  const started = thread.status !== "pending";
  return (
    <DetailRow label="Bot" icon="Bot">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {bot && <BotAvatar bot={bot} size={14} state={botStates.get(bot.id)} />}
        <select value={bot?.id ?? NONE} aria-label={started ? "Hand off to bot" : "Bot"}
          title={started ? "A started thread keeps its bot. Picking another opens a handoff." : undefined}
          onChange={(e) => void sendThreadToBot(rpc, thread, e.target.value || null)}
          style={{ minWidth: 0, maxWidth: 180, border: "none", background: "transparent", color: "var(--foreground)", fontSize: "inherit", padding: 0, cursor: "pointer" }}>
          <option value={NONE}>{started && bot ? "Hand off without a bot" : "No bot"}</option>
          {bots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {state.source === "inherited" && <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>inherited</span>}
      </span>
    </DetailRow>
  );
}

function InstructionsSection({ threadId }: { threadId: string }) {
  const { state } = useThreadBot(threadId);
  if (!state?.instructions) return null;
  return (
    <InfoSection label="Bot instructions">
      <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted-foreground)" }}>
        What a session starting now gets. A running session keeps the version it started with.
      </p>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.45, fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
        {state.instructions}
      </pre>
    </InfoSection>
  );
}

export function registerBotThreadInfo(app: PluginAppBuilder) {
  app.slots.experimental_threadInfoRow({ id: "bot", group: ROW_GROUPS.thread, order: 90, component: ({ threadId }) => <BotRow threadId={threadId} /> });
  app.slots.experimental_threadInfoSection({ id: "bot-instructions", group: SECTION_GROUPS.related, order: 90, component: ({ threadId }) => <InstructionsSection threadId={threadId} /> });
}
