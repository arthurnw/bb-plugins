import { useRealtime, useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { botsContract } from "./bots-server";
import { botIconName, type Bot } from "@arthurnw/bb-shared/bots";
import { useBots } from "./bot-avatars";
import { sendThreadToBot } from "./bots-view";

const NO_BOT = "none";

interface Data {
  bots: readonly Bot[] | null;
  threadBots: Record<string, string>;
  rpc: ReturnType<typeof useRpc<typeof botsContract>>;
}

function useBotData(): Data {
  const rpc = useRpc<typeof botsContract>();
  const bots = useBots();
  const [threadBots, setThreadBots] = useState<Record<string, string>>({});
  const load = () => { rpc.call("threadBots", {}).then(({ threads }) => setThreadBots(threads), () => {}); };
  useEffect(load, [rpc]);
  useRealtime("bots", load);
  return { bots, threadBots, rpc };
}

/**
 * "Bot" in every thread menu. A thread that has not started is reassigned in
 * place; a started one keeps its session's instructions, so picking a bot
 * opens a Launcher handoff to it instead.
 */
export function registerBotThreadAction(app: PluginAppBuilder) {
  app.slots.experimental_threadAction<Data>({
    id: "bot", title: "Bot", icon: "Bot", group: "1_open", order: 50,
    useData: useBotData,
    item: ({ thread, data }) => {
      const { bots, threadBots, rpc } = data;
      if (!bots || bots.length === 0 || thread.archivedAt !== null) return null;
      const current = threadBots[thread.id] ?? null;
      const pending = thread.status === "pending";
      const currentBot = bots.find((bot) => bot.id === current);
      return {
        label: pending ? "Bot" : "Hand off to bot",
        ...(currentBot ? { detail: currentBot.name } : {}),
        icon: currentBot ? botIconName(currentBot.avatarSlot) : "Bot",
        choices: {
          ...(pending ? {} : { hint: "Opens a handoff. A started thread keeps the bot it began with." }),
          items: [
            ...bots.map((bot) => ({ id: bot.id, label: bot.name, icon: botIconName(bot.avatarSlot), selected: bot.id === current })),
            { id: NO_BOT, label: pending ? "No bot" : "Without a bot", selected: pending && current === null },
          ],
        },
        run: async ({ value }) => {
          if (value) await sendThreadToBot(rpc, thread, value === NO_BOT ? null : value);
        },
      };
    },
  });
}
