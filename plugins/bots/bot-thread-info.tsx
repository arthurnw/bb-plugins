// The thread Info tab: the initiative bot a thread belongs to, and what Bots adds to its instructions.
import {
  experimental_DetailRow as DetailRow,
  experimental_InfoSection as InfoSection,
  experimental_THREAD_INFO_ROW_GROUPS as ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS as SECTION_GROUPS,
  useRealtime, useRpc, type PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { botsContract } from "./bots-server";
import { BotAvatar, useBots, useBotStates } from "./bot-avatars";

type ThreadBot = { botId: string | null; source: "own" | "inherited" | "none" | "detached"; instructions: string | null };

function useThreadBot(threadId: string) {
  const rpc = useRpc<typeof botsContract>();
  const [state, setState] = useState<ThreadBot | null>(null);
  const load = () => { rpc.call("threadBot", { threadId }).then(setState, () => setState(null)); };
  useEffect(load, [rpc, threadId]);
  useRealtime("bots", load);
  return { state };
}

function BotRow({ threadId }: { threadId: string }) {
  const { state } = useThreadBot(threadId);
  const bots = useBots();
  const botStates = useBotStates();
  const bot = state?.botId ? bots?.find((item) => item.id === state.botId) ?? null : null;
  if (!bot) return null;
  const role = bot.coordinatorThreadId === threadId ? "coordinator" : "worker";
  return (
    <DetailRow label="Bot" icon="Bot">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <BotAvatar bot={bot} size={14} state={botStates.get(bot.id)} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.name}</span>
        <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{role}</span>
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
