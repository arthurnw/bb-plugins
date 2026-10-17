import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { filter, toOptions, type ProjectOption } from "./projects";

export async function loadProjectOptions(sdk: ReturnType<typeof useSdk>) {
  return toOptions(await sdk.projects.list({ includePersonal: true }));
}

/** Project options loaded on mount; null while loading. */
export function useProjectOptions() {
  const sdk = useSdk();
  const [options, setOptions] = useState<ProjectOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadProjectOptions(sdk).then(
      (loaded) => !cancelled && setOptions(loaded),
      () => !cancelled && setOptions([]),
    );
    return () => { cancelled = true; };
  }, [sdk]);
  return options;
}

export function ProjectList({ selectedId, onChoose, onClose, selectedLabel = "current" }: { selectedLabel?: string; selectedId: string | null; onChoose: (option: ProjectOption) => void; onClose: () => void }) {
  const options = useProjectOptions();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => filter(options ?? [], query), [options, query]);

  // Start on the selected project when the list first loads.
  useEffect(() => {
    if (options === null || query !== "") return;
    setActive(Math.max(0, matches.findIndex((o) => o.id === selectedId)));
  }, [options]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const down = event.key === "ArrowDown" || (event.ctrlKey && (event.key === "n" || event.key === "j"));
    const up = event.key === "ArrowUp" || (event.ctrlKey && (event.key === "p" || event.key === "k"));
    if (down || up) {
      event.preventDefault();
      if (matches.length > 0) setActive((i) => (i + (down ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = matches[active];
      if (option) onChoose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 280, maxHeight: 320 }}>
      <input
        autoFocus
        value={query}
        placeholder="Switch project…"
        aria-label="Search projects"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        style={{
          padding: "8px 12px",
          border: "none",
          borderBottom: "1px solid var(--border)",
          background: "transparent",
          color: "var(--foreground)",
          fontSize: 13,
          outline: "none",
        }}
      />
      <div ref={listRef} role="listbox" aria-label="Projects" style={{ overflowY: "auto", padding: 4 }}>
        {options === null ? (
          <div style={emptyStyle}>Loading…</div>
        ) : matches.length === 0 ? (
          <div style={emptyStyle}>No matching projects</div>
        ) : (
          matches.map((option, index) => (
            <div
              key={option.id}
              role="option"
              data-index={index}
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChoose(option)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                color: "var(--foreground)",
                background: index === active ? "var(--accent)" : "transparent",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.name}</span>
              {option.id === selectedId && <span style={{ color: "var(--muted-foreground)" }}>{selectedLabel}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const emptyStyle = { padding: "6px 8px", fontSize: 12, color: "var(--muted-foreground)" };

