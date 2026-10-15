// bb-plugin-canvas frontend: a zoomable canvas of bb threads in its own nav
// page. React and the SDK come from the host at load time.
import "@xyflow/react/dist/style.css";
import "./canvas/canvas.css";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CanvasPage } from "./canvas/Canvas";
import { CanvasNavIcon } from "./canvas/icons.tsx";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: "bb-canvas/workflow", component: CanvasNavIcon });
  app.slots.navPanel({
    id: "canvas",
    title: "Canvas",
    icon: "bb-canvas/workflow",
    path: "canvas",
    component: CanvasPage,
  });
});
