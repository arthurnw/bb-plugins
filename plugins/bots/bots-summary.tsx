// The Bots view of the Bots list: fixed-position bot tiles, then pinned
// threads (with or without a bot), then recent bot threads.
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadRowMetadata as ThreadRowMetadata,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  ThreadTitle, useRpc, type PluginSidebarThread, type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Bot } from "@arthurnw/bb-shared/bots";
import { modelSpec } from "@arthurnw/bb-shared/selection";
import { BotAvatar, useBotStates } from "./bot-avatars";
import { threadAvatarState } from "@arthurnw/bb-shared/avatars";
import { useLauncherModelState } from "./launcher-models";
import { openNewThread } from "@arthurnw/bb-shared/events";
import { feedSort, sortFeed, type FeedSort } from "./list-model";

const FEED_PAGE = 10;
const SORT_KEY = "bb-bots:feed-sort";
const SORT_LABELS: Record<FeedSort, string> = { updated: "Last activity", attention: "Last response", created: "Created" };
const BUSY = new Set(["starting", "active", "stopping"]);

function ago(at: number) {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

export interface SummaryProps {
  bots: readonly Bot[];
  threads: readonly PluginSidebarThread[];
  threadBots: Record<string, string>;
  activeThreadId: string | null;
  activeProjectId: string | null;
  builtInSort: string;
  showRowMetadata: boolean;
  actionTarget: (thread: PluginSidebarThread) => PluginThreadActionTarget;
  onOpen: (thread: PluginSidebarThread) => void;
  onShowBot: (botId: string) => void;
  /** Starts a pointer drag of a feed row; tiles are `bot:<id>` drop targets. */
  startDrag: (thread: PluginSidebarThread) => (event: ReactPointerEvent) => void;
  /** The drop target under the pointer during a drag. */
  over: string | null;
}

function FeedRow({ thread, bot, sort, active, showRowMetadata, actionTarget, onOpen, startDrag, pinned }: {
  thread: PluginSidebarThread; bot: Bot | undefined; sort: FeedSort; active: boolean; showRowMetadata: boolean;
  /** Pinned rows show only the bot name, not the time since. */
  pinned?: boolean;
  actionTarget: SummaryProps["actionTarget"]; onOpen: (thread: PluginSidebarThread) => void; startDrag: SummaryProps["startDrag"];
}) {
  const split = useSidebarThreadSplit(thread.id);
  const { providers } = useProviders();
  const provider = providers.find((item) => item.id === thread.providerId) ?? { id: thread.providerId };
  const at = sort === "created" ? thread.createdAt : sort === "attention" ? thread.latestAttentionAt : thread.updatedAt;
  return (
    <ThreadActionsContextMenu thread={actionTarget(thread)}>
      <a href={thread.href} draggable={false} data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id} aria-current={active ? "page" : undefined}
        onPointerDown={(event) => { split.splitProps.onPointerDown?.(event); startDrag(thread)(event); }}
        onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); onOpen(thread); }}
        style={{ ...feedRow, background: active ? "var(--accent)" : "transparent" }}>
        <span style={{ marginTop: 1, width: 16, height: 16, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          {bot ? <BotAvatar bot={bot} size={16} state={threadAvatarState(thread)} /> : <ProviderIcon providerKind="agent" provider={provider} aria-hidden className="size-3.5" />}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: thread.isUnread ? 600 : 400 }}>
            <ThreadTitle threadId={thread.id} />
          </span>
          {pinned
            ? bot && <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)" }}>{bot.name}</span>
            : <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)" }}>{bot ? `${bot.name} · ${ago(at)}` : ago(at)}</span>}
          {showRowMetadata && <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", overflow: "hidden" }}><ThreadRowMetadata thread={thread} /></span>}
        </span>
        <span style={{ flex: "none", marginTop: 2 }}><ThreadStatusGlyph indicator={thread.indicator} size="compact" /></span>
      </a>
    </ThreadActionsContextMenu>
  );
}

export function BotsSummary(props: SummaryProps) {
  const { bots, threads, threadBots } = props;
  const names = useLauncherModelState()?.names ?? {};
  const botStates = useBotStates();
  const [stored, setStored] = useState(() => localStorage.getItem(SORT_KEY));
  const sort = feedSort(stored, props.builtInSort);
  const [shown, setShown] = useState(FEED_PAGE);

  const byBot = useMemo(() => {
    const known = new Map(bots.map((bot) => [bot.id, bot]));
    const result = new Map<string, PluginSidebarThread[]>();
    for (const thread of threads) {
      const bot = known.get(threadBots[thread.id] ?? "");
      if (bot) result.set(bot.id, [...(result.get(bot.id) ?? []), thread]);
    }
    return result;
  }, [bots, threads, threadBots]);
  // Pinned threads show only under Pinned, as in the Threads view, and are the
  // one place threads without a bot appear in this view.
  const pinned = useMemo(() => threads.filter((thread) => thread.isPinned).sort((a, b) => b.updatedAt - a.updatedAt), [threads]);
  const feed = useMemo(() => sortFeed([...byBot.values()].flat().filter((thread) => !thread.isPinned), sort), [byBot, sort]);
  const botOf = (thread: PluginSidebarThread) => bots.find((bot) => bot.id === threadBots[thread.id]);
  const rowProps = { sort, showRowMetadata: props.showRowMetadata, actionTarget: props.actionTarget, onOpen: props.onOpen, startDrag: props.startDrag };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6, padding: "4px 8px" }}>
        {bots.map((bot) => {
          const own = byBot.get(bot.id) ?? [];
          const busy = own.filter((thread) => BUSY.has(thread.status)).length;
          const waiting = own.filter((thread) => thread.hasPendingInteraction).length;
          // Needs-you outranks running; the glyph is bb's own, as on thread rows.
          const urgent = own.find((thread) => thread.hasPendingInteraction) ?? own.find((thread) => BUSY.has(thread.status));
          const indicator = !urgent ? null : urgent.hasPendingInteraction ? "waiting-for-input" as const
            : urgent.indicator === "none" ? "runtime" as const : urgent.indicator;
          const dropping = props.over === `bot:${bot.id}`;
          return (
            <div key={bot.id} role="button" tabIndex={0} aria-label={`Show ${bot.name}'s threads`} data-drop={`bot:${bot.id}`}
              onClick={() => props.onShowBot(bot.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onShowBot(bot.id); } }}
              style={{ ...tile, ...(dropping ? { background: "var(--accent)", outline: "2px solid var(--ring, var(--primary))", outlineOffset: -2 } : {}) }}>
              {/* One column so the status glyph centers under the +. */}
              <span style={{ position: "absolute", top: 6, right: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <button type="button" aria-label={`New thread with ${bot.name}`} title={`New thread with ${bot.name}`}
                  onClick={(e) => { e.stopPropagation(); openNewThread({ projectId: bot.projectId ?? props.activeProjectId, botId: bot.id }); }}
                  style={plus}><Icon name="Plus" className="size-3.5" aria-hidden /></button>
                {indicator && (
                  <span aria-label={waiting > 0 ? `${bot.name} needs you` : `${bot.name} is working`} style={{ display: "inline-flex" }}>
                    <ThreadStatusGlyph indicator={indicator} size="compact" />
                  </span>
                )}
              </span>
              <BotAvatar bot={bot} size={36} state={botStates.get(bot.id)} track />
              <div style={{ fontWeight: 600, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.name}</div>
              <div style={{ ...muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.model ? modelSpec(bot.model, names) : "Any model"}</div>
              <div style={{ ...muted, display: "flex", flexWrap: "wrap", gap: "0 8px", marginTop: 4 }}>
                <span><b style={strong}>{own.length}</b> {own.length === 1 ? "thread" : "threads"}</span>
                {busy > 0 && <span style={{ color: "var(--primary, #2563eb)" }}><b>{busy}</b> running</span>}
                {waiting > 0 && <span style={{ color: "var(--warning, #d97706)" }}><b>{waiting}</b> need you</span>}
              </div>
            </div>
          );
        })}
      </div>
      {pinned.length > 0 && (
        <section data-drop="pinned" style={{ borderRadius: 8, outline: props.over === "pinned" ? "2px solid var(--ring, var(--primary))" : "none", outlineOffset: -2 }}>
          <div style={{ ...header, padding: "8px 8px 2px" }}>Pinned</div>
          <div style={{ padding: "0 4px" }}>
            {pinned.map((thread) => (
              <FeedRow key={thread.id} thread={thread} bot={botOf(thread)} active={thread.id === props.activeThreadId} {...rowProps} pinned />
            ))}
          </div>
        </section>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 8px 2px" }}>
        <span style={{ ...header, flex: 1 }}>Recent across bots</span>
        <select value={sort} aria-label="Sort recent threads" title="Sort"
          onChange={(e) => { localStorage.setItem(SORT_KEY, e.target.value); setStored(e.target.value); }}
          style={{ border: "none", background: "transparent", color: "var(--muted-foreground)", fontSize: 12, cursor: "pointer" }}>
          {(Object.keys(SORT_LABELS) as FeedSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
        </select>
      </div>
      {byBot.size === 0 && <div style={{ padding: "2px 12px", fontSize: 12, color: "var(--muted-foreground)" }}>No bot threads yet. Use + on a bot to start one.</div>}
      <div style={{ padding: "0 4px" }}>
        {feed.slice(0, shown).map((thread) => (
          <FeedRow key={thread.id} thread={thread} bot={botOf(thread)} active={thread.id === props.activeThreadId} {...rowProps} />
        ))}
      </div>
      {feed.length > shown && (
        <button type="button" onClick={() => setShown(shown + FEED_PAGE)}
          style={{ border: "none", background: "transparent", cursor: "pointer", textAlign: "left", padding: "2px 12px", fontSize: 12, color: "var(--muted-foreground)" }}>
          Show {Math.min(FEED_PAGE, feed.length - shown)} more
        </button>
      )}
    </div>
  );
}

const header: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" };
const muted: CSSProperties = { fontSize: 11.5, color: "var(--muted-foreground)" };
const strong: CSSProperties = { color: "var(--foreground)", fontWeight: 600 };
const tile: CSSProperties = { position: "relative", border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--background)", cursor: "pointer", fontSize: 13, minWidth: 0 };
const plus: CSSProperties = { width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--muted-foreground)", fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 0 };
const feedRow: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 8px", borderRadius: 6, fontSize: 13, color: "var(--foreground)", textDecoration: "none", cursor: "pointer" };
