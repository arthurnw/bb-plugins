import {
  definePluginApp,
  experimental_useRpcKeyedQuery,
  type ExperimentalThreadRowMetadataDataInput,
  type ExperimentalThreadRowMetadataProps,
} from "@get-bb/plugin-sdk/app";
import { rpcContract } from "./server";

type Names = Record<string, string | null> | undefined;

function useProjectNames({ threads }: ExperimentalThreadRowMetadataDataInput): Names {
  const keys = [...new Set(threads.map((thread) => thread.projectId))];
  return experimental_useRpcKeyedQuery({
    contract: rpcContract,
    method: "projectNames",
    keys,
    enabled: keys.length > 0,
  }).data;
}

function ProjectName({ thread, data }: ExperimentalThreadRowMetadataProps<Names>) {
  const name = data?.[thread.projectId];
  if (!name) return null;
  return (
    <span title={`Project: ${name}`} className="truncate text-xs opacity-70">
      {name}
    </span>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadRowMetadata<Names>({
    id: "project-name",
    order: 0,
    useData: useProjectNames,
    component: ProjectName,
  });
});
