// The All mode's Organize menu and each group's menu. Every option writes the
// built-in thread list's preferences, the same ones its own menus write.
import { experimental_Icon as Icon, experimental_useExperiment as useExperiment, type PluginSidebarSection } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { groupsByEnvironment, pickSort, shownDirection, SORT_FIELDS, toggleEnvironmentGrouping, toggleLifecycle } from "./all-model";
import { SectionDelete, SectionRename } from "./list-parts";
import { MenuCheck, MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger, SubMenu } from "./menu";
import type { PrefKey, ThreadListPrefs } from "./thread-list-prefs";

type SetPref = <K extends PrefKey>(key: K, value: ThreadListPrefs[K]) => void;
const ORGANIZATIONS = [
  { label: "By project", mode: "project" },
  { label: "By machine", mode: "machine" },
  { label: "Custom", mode: "chronological" },
] as const;

const writeAll = (set: SetPref, values: Partial<ThreadListPrefs>) => {
  for (const [key, value] of Object.entries(values) as [PrefKey, ThreadListPrefs[PrefKey]][]) set(key, value);
};

export function OrganizeMenu({ prefs, set }: { prefs: ThreadListPrefs; set: SetPref }) {
  const metadataExperiment = useExperiment("threadRowMetadata");
  const byEnvironment = groupsByEnvironment(prefs);
  const direction = shownDirection(prefs.chronologicalSort, prefs.sortDirection);
  const currentSort = prefs.chronologicalSort === "none" ? "updated" : prefs.chronologicalSort;
  return (
    <MenuRoot>
      <MenuTrigger label="Organize"><Icon name="SlidersHorizontal" className="size-3.5" aria-hidden /></MenuTrigger>
      <MenuContent label="Organize">
        <SubMenu label="Organize" icon="Layers">
          <MenuLabel>Sections</MenuLabel>
          {ORGANIZATIONS.map((item) => (
            <MenuCheck key={item.mode} role="menuitemradio" checked={prefs.organizationMode === item.mode} onToggle={() => set("organizationMode", item.mode)}>{item.label}</MenuCheck>
          ))}
          <MenuSeparator />
          <MenuLabel>Groups</MenuLabel>
          <MenuCheck checked={byEnvironment} onToggle={() => writeAll(set, toggleEnvironmentGrouping(prefs))}>By environment</MenuCheck>
          <MenuCheck checked={prefs.groupByReadStatus} onToggle={() => set("groupByReadStatus", !prefs.groupByReadStatus)}>By read status</MenuCheck>
          <MenuSeparator />
          <MenuLabel>Rows</MenuLabel>
          <MenuCheck checked={prefs.showProviderIcons} onToggle={() => set("showProviderIcons", !prefs.showProviderIcons)}>Provider icons</MenuCheck>
          {metadataExperiment && <MenuCheck checked={prefs.showRowMetadata} onToggle={() => set("showRowMetadata", !prefs.showRowMetadata)}>Metadata</MenuCheck>}
        </SubMenu>
        <SubMenu label="Sort by" icon="ArrowUpDown">
          {SORT_FIELDS.map((field) => (
            <MenuCheck key={field.sort} role="menuitemradio" checked={currentSort === field.sort} mark={direction === "ascending" ? "ArrowUp" : "ArrowDown"}
              onToggle={() => writeAll(set, pickSort(prefs, field.sort))}>{field.label}</MenuCheck>
          ))}
        </SubMenu>
        <SubMenu label="Filter" icon="Filter">
          {(["active", "archived"] as const).map((lifecycle) => (
            <MenuCheck key={lifecycle} checked={prefs.threadLifecycles.includes(lifecycle)}
              disabled={prefs.threadLifecycles.length === 1 && prefs.threadLifecycles[0] === lifecycle}
              onToggle={() => set("threadLifecycles", toggleLifecycle(prefs.threadLifecycles, lifecycle))}>
              {lifecycle === "active" ? "Active" : "Archived"}
            </MenuCheck>
          ))}
        </SubMenu>
      </MenuContent>
    </MenuRoot>
  );
}

/** A group's ⋯ menu: Rename and Delete for a custom section, then Hide from list or Show in list. */
export function GroupMenu({ title, groupKey, section, prefs, set }: {
  title: string; groupKey: string; section?: PluginSidebarSection; prefs: ThreadListPrefs; set: SetPref;
}) {
  const [mode, setMode] = useState<"rename" | "delete" | null>(null);
  const done = () => setMode(null);
  if (section && mode === "rename") return <SectionRename section={section} onDone={done} />;
  if (section && mode === "delete") return <SectionDelete section={section} onDone={done} />;
  const hidden = prefs.hiddenGroups.includes(groupKey);
  return (
    <MenuRoot>
      <MenuTrigger label={`${title} options`}>⋯</MenuTrigger>
      <MenuContent label={`${title} options`}>
        {section && <MenuItem icon="Pencil" onSelect={() => setMode("rename")}>Rename</MenuItem>}
        {section && <MenuItem icon="Trash2" onSelect={() => setMode("delete")}>Delete</MenuItem>}
        {section && <MenuSeparator />}
        {hidden
          ? <MenuItem icon="Eye" onSelect={() => set("hiddenGroups", prefs.hiddenGroups.filter((key) => key !== groupKey))}>Show in list</MenuItem>
          : <MenuItem icon="EyeOff" onSelect={() => set("hiddenGroups", [...prefs.hiddenGroups, groupKey])}>Hide from list</MenuItem>}
      </MenuContent>
    </MenuRoot>
  );
}
