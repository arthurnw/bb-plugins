import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icons.tsx";
import { rankMatches } from "./nav.ts";

export interface PickerItem {
  id: string;
  title: string;
  /** Searched with the title; shown on the right. */
  detail?: string;
  /** Extra searchable text that is not shown. */
  keywords?: string;
  /** A CSS color for the leading dot. */
  dot?: string;
  icon?: IconName;
  recency: number;
}

const MAX_ROWS = 60;
const CREATE_ID = "\u0000create";

/** A keyboard-first list picker drawn over the canvas. */
export function Picker({
  title,
  placeholder,
  items,
  onPick,
  onClose,
  create,
}: {
  title: string;
  placeholder: string;
  items: readonly PickerItem[];
  onPick(item: PickerItem): void;
  onClose(): void;
  /** Adds a last row that creates something named after the query. */
  create?: { label(query: string): string; run(query: string): void };
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useMemo(
    () =>
      rankMatches(items, query, (item) => ({
        title: item.title,
        rest: `${item.detail ?? ""} ${item.keywords ?? ""}`,
        recency: item.recency,
      }))
        .slice(0, MAX_ROWS)
        .concat(
          create !== undefined && query.trim() !== ""
            ? [{ id: CREATE_ID, title: create.label(query.trim()), icon: "Plus" as const, recency: 0 }]
            : [],
        ),
    [items, query, create],
  );
  const pick = (row: PickerItem) => {
    if (row.id === CREATE_ID) create?.run(query.trim());
    else onPick(row);
  };
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const move = (delta: number) => setActive((index) => (rows.length === 0 ? 0 : (index + delta + rows.length) % rows.length));

  return (
    <div className="absolute inset-0 z-20 flex justify-center bg-black/10 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex h-fit max-h-[60vh] w-[min(600px,90%)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Icon name="Search" className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            placeholder={placeholder}
            aria-label={title}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              const ctrl = event.ctrlKey && !event.metaKey;
              if (event.key === "ArrowDown" || (ctrl && (event.key === "n" || event.key === "j"))) move(1);
              else if (event.key === "ArrowUp" || (ctrl && (event.key === "p" || event.key === "k"))) move(-1);
              else if (event.key === "Enter") {
                const row = rows[active];
                if (row !== undefined) pick(row);
              } else if (event.key === "Escape") onClose();
              else return;
              event.preventDefault();
            }}
          />
        </div>
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox">
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</li>
          ) : (
            rows.map((row, index) => (
              <li
                key={row.id}
                data-index={index}
                role="option"
                aria-selected={index === active}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm",
                  index === active && "bg-state-active",
                )}
                onMouseMove={() => setActive(index)}
                onClick={() => pick(row)}
              >
                {row.icon !== undefined ? (
                  <Icon name={row.icon} className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <span className="size-2 shrink-0 rounded-full" style={{ background: row.dot ?? "var(--muted-foreground)" }} />
                )}
                <span className="min-w-0 flex-1 truncate">{row.title}</span>
                {row.detail ? <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{row.detail}</span> : null}
                {index === active ? <Icon name="CornerDownLeft" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>↑↓ or ⌃J/⌃K to move</span>
          <span>↵ to pick</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
