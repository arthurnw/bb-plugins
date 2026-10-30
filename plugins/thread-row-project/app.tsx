import {
  definePluginApp,
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  type ExperimentalThreadRowMetadataDataInput,
  type ExperimentalThreadRowMetadataProps,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { rpcContract } from "./server";
import { DISPLAY_MODES, isImageUrl, type DisplayMode } from "./shared";

type Rows = Record<string, { name: string | null; icon: string | null; mode: DisplayMode }> | undefined;

function useRowDisplay({ threads }: ExperimentalThreadRowMetadataDataInput): Rows {
  const keys = [...new Set(threads.map((thread) => thread.projectId))];
  return experimental_useRpcKeyedQuery({
    contract: rpcContract,
    method: "rowDisplay",
    keys,
    enabled: keys.length > 0,
  }).data;
}

function Icon({ value }: { value: string }) {
  return isImageUrl(value) ? (
    <img src={value} alt="" className="size-3.5 shrink-0 rounded-sm object-contain" />
  ) : (
    <span className="shrink-0 text-xs leading-none">{value}</span>
  );
}

function ProjectBadge({ thread, data }: ExperimentalThreadRowMetadataProps<Rows>) {
  const row = data?.[thread.projectId];
  if (!row?.name) return null;
  // Without an icon, fall back to the name so the badge never disappears.
  const showIcon = row.icon !== null && row.mode !== "name";
  const showName = row.mode !== "icon" || row.icon === null;
  return (
    <span title={`Project: ${row.name}`} className="inline-flex min-w-0 items-center gap-1 opacity-80">
      {showIcon && row.icon ? <Icon value={row.icon} /> : null}
      {showName ? <span className="truncate text-xs">{row.name}</span> : null}
    </span>
  );
}

const MODE_LABELS: Record<DisplayMode, string> = {
  icon: "Emoji / image",
  name: "Project name",
  both: "Both",
};

function IconField({ projectId, icon }: { projectId: string; icon: string | null }) {
  const { mutate } = experimental_useRpcMutation({ contract: rpcContract, method: "setIcon" });
  const [draft, setDraft] = useState(icon ?? "");
  useEffect(() => setDraft(icon ?? ""), [icon]);
  const save = () => {
    if (draft.trim() !== (icon ?? "")) void mutate({ projectId, icon: draft.trim() || null });
  };
  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      placeholder="Emoji or image URL"
      className="h-8 w-64 rounded-md border border-border bg-transparent px-2 text-sm"
    />
  );
}

function Settings() {
  const { data } = experimental_useRpcQuery({ contract: rpcContract, method: "settings", input: {} });
  const { mutate: setMode } = experimental_useRpcMutation({ contract: rpcContract, method: "setMode" });
  if (!data) return null;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-4 text-sm">
        Show on thread rows
        <select
          value={data.mode}
          onChange={(event) => void setMode({ mode: event.target.value as DisplayMode })}
          className="h-8 rounded-md border border-border bg-transparent px-2 text-sm"
        >
          {DISPLAY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-2">
        {data.projects.map((project) => (
          <div key={project.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 truncate">
              {project.icon ? <Icon value={project.icon} /> : null}
              {project.name}
            </span>
            <IconField projectId={project.id} icon={project.icon} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadRowMetadata<Rows>({
    id: "project",
    order: 0,
    useData: useRowDisplay,
    component: ProjectBadge,
  });
  app.slots.settingsSection({
    id: "project-display",
    title: "Project display",
    description: "Choose an emoji or image for each project and what thread rows show.",
    component: Settings,
  });
});
