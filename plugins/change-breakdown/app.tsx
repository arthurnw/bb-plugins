import { defineRpcContract } from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_InfoSection as InfoSection,
  experimental_THREAD_INFO_SECTION_GROUPS as SECTION_GROUPS,
  experimental_useRpcKeyedQuery,
  experimental_useRpcQuery,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { z } from "zod";
import { KIND_LABELS, summarize, type ChangedFile, type Group, type Totals } from "./shared";

// The part of the Git plugin's contract this plugin reads; see `bb plugin rpc inspect bb--git`.
const git = defineRpcContract({
  status: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(
      z.string(),
      z.object({
        outcome: z.string(),
        workspace: z
          .object({
            branch: z.object({ defaultBranch: z.string() }),
            mergeBase: z.object({ mergeBaseBranch: z.string() }).nullable().optional(),
          })
          .optional(),
      }),
    ),
  },
  files: {
    input: z.object({
      environmentId: z.string(),
      target: z.object({ type: z.literal("all"), mergeBaseBranch: z.string() }),
      ignoreWhitespace: z.boolean(),
    }),
    output: z.object({
      outcome: z.string(),
      files: z
        .array(z.object({ path: z.string(), additions: z.number(), deletions: z.number(), binary: z.boolean() }))
        .optional(),
    }),
  },
});

const PLUGIN_ID = "bb--git";

function useChangedFiles(environmentId: string | null): ChangedFile[] | null {
  const status = experimental_useRpcKeyedQuery({
    pluginId: PLUGIN_ID,
    contract: git,
    method: "status",
    keys: environmentId ? [environmentId] : [],
  }).data;
  const workspace = environmentId ? status?.[environmentId]?.workspace : undefined;
  const mergeBaseBranch = workspace?.mergeBase?.mergeBaseBranch ?? workspace?.branch.defaultBranch;
  const files = experimental_useRpcQuery({
    pluginId: PLUGIN_ID,
    contract: git,
    method: "files",
    input: {
      environmentId: environmentId ?? "",
      target: { type: "all", mergeBaseBranch: mergeBaseBranch ?? "" },
      ignoreWhitespace: false,
    },
    enabled: Boolean(environmentId && mergeBaseBranch),
  }).data;
  return files?.files ?? null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function Stat({ additions, deletions }: Totals) {
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      <span className="text-emerald-500">+{fmt(additions)}</span>{" "}
      <span className="text-red-500">−{fmt(deletions)}</span>
    </span>
  );
}

function GroupRow({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 py-1 text-left text-sm"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0 opacity-60" />
          <span>{KIND_LABELS[group.kind]}</span>
          <span className="opacity-60">{group.files.length}</span>
        </span>
        <Stat additions={group.additions} deletions={group.deletions} />
      </button>
      {open ? (
        <ul className="mb-1 ml-4 flex flex-col gap-0.5">
          {group.files.map((file) => (
            <li key={file.path} className="flex items-center justify-between gap-3 text-xs opacity-80">
              <span className="min-w-0 truncate" title={file.path} dir="rtl">
                <bdi>{file.path}</bdi>
              </span>
              <Stat additions={file.additions} deletions={file.deletions} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Breakdown({ environment }: ExperimentalThreadInfoProps) {
  const files = useChangedFiles(environment?.id ?? null);
  if (!files || files.length === 0) return null;
  const { groups, total } = summarize(files);
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <GroupRow key={group.kind} group={group} />
      ))}
      {groups.length > 1 ? (
        <div className="mt-1 flex items-center justify-between border-t border-border pt-1 text-sm">
          <span className="opacity-60">Total · {files.length} files</span>
          <Stat additions={total.additions} deletions={total.deletions} />
        </div>
      ) : null}
    </div>
  );
}

function InfoBreakdown(props: ExperimentalThreadInfoProps) {
  const files = useChangedFiles(props.environment?.id ?? null);
  if (!files || files.length === 0) return null;
  return (
    <InfoSection label="Change breakdown" count={files.length}>
      <Breakdown {...props} />
    </InfoSection>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadContextCardSection({
    id: "change-breakdown",
    title: "Change breakdown",
    group: SECTION_GROUPS.changes,
    order: 5,
    component: Breakdown,
  });
  app.slots.experimental_threadInfoSection({
    id: "change-breakdown-info",
    group: SECTION_GROUPS.changes,
    order: 5,
    component: InfoBreakdown,
  });
});
