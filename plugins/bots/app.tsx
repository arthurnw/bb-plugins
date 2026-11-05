import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { BotSettings } from "./bot-settings";
import { registerBotIcons } from "./bot-avatars";
import { registerBotThreadAction } from "./bot-thread-action";
import { registerBotThreadInfo } from "./bot-thread-info";
import { BotThreadList } from "./bots-view";
import { registerFallbackDialog } from "./fallback-dialog";
import { BotChip, BOT_POPUP_ID, BotPopup } from "./native-bot";

export default definePluginApp((app) => {
  registerBotIcons(app);
  registerBotThreadAction(app);
  registerBotThreadInfo(app);
  registerFallbackDialog(app);
  app.slots.experimental_threadList({
    id: "bots", title: "Bots", description: "Bots and custom sections in one order you arrange. Drag a thread onto a bot to hand it off, onto a thread to nest it, or onto a section to file it.",
    component: ({ activeThreadId, activeProjectId, onNavigate }) =>
      <BotThreadList activeThreadId={activeThreadId} activeProjectId={activeProjectId} onNavigate={onNavigate} />,
  });
  app.slots.settingsSection({ id: "bots", title: "Bots", description: "Saved launch configurations with their own instructions and memory.", component: BotSettings });
  app.composer.customize({
    id: "bots",
    scopes: ["new-thread"],
    experimental_popups: [{ id: BOT_POPUP_ID, label: "Choose bot", component: BotPopup }],
    actions: [{ id: "bot-chip", component: BotChip }],
  });
});
