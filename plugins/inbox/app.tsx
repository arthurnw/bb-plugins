// bb-plugin-inbox frontend: every agent thread in one list, in its own nav
// page. React and the SDK come from the host at load time.
import "./inbox/inbox.css";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { InboxNavIcon } from "./inbox/icons.tsx";
import { InboxPage, NeedsYouCount } from "./inbox/Inbox.tsx";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: "bb-inbox/inbox", component: InboxNavIcon });
  app.slots.navPanel({
    id: "inbox",
    title: "Inbox",
    icon: "bb-inbox/inbox",
    path: "inbox",
    component: InboxPage,
    experimental_sidebarAccessory: NeedsYouCount,
  });
});
