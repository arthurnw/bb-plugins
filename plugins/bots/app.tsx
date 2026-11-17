import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { BotSettings } from "./bot-settings";
import { registerBotIcons } from "./bot-avatars";
import { registerBotThreadInfo } from "./bot-thread-info";
import { BotThreadList } from "./bots-view";
import { registerNewBotDialog } from "./new-bot-dialog";
import { registerPaneAvatar } from "./pane-avatar";
import { registerZoo } from "./zoo";

export default definePluginApp((app) => {
  registerBotIcons(app);
  registerBotThreadInfo(app);
  registerNewBotDialog(app);
  registerPaneAvatar(app);
  registerZoo(app);
  app.slots.experimental_threadList({
    id: "bots", title: "Bots", description: "Bots and custom sections in one order you arrange. Drag a thread onto a bot to make it one of its workers, onto a thread to nest it, or onto a section to file it.",
    component: ({ activeThreadId, activeProjectId, onNavigate }) =>
      <BotThreadList activeThreadId={activeThreadId} activeProjectId={activeProjectId} onNavigate={onNavigate} />,
  });
  app.slots.settingsSection({ id: "bots", title: "Bots", description: "Initiative bots: each one coordinates a project through its own thread and workers.", component: BotSettings });
});
