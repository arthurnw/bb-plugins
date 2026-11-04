// Bot chip and picker for bb's own New thread composer. The overlay has its
// own picker, so both stay out of composers the overlay embeds.
import { experimental_usePluginId as usePluginId, useComposer, type ComposerSelection, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BotAvatar, useBots } from "./bot-avatars";
import { draftBotId, draftWithBot, filterBots, type Bot } from "./bots";
import { markEnvironmentApplied } from "./default-environment";
import { EXISTING_PROVIDER_ID } from "./existing-branch";
import { PROVIDER_ID } from "./named-worktree";

export const BOT_POPUP_ID = "bot";

const isOverlay = (composer: PluginComposerApi) => composer.key.includes("launcher-");

// Picking a bot sets the native pickers, which bb also saves as the next
// thread's defaults. The values from before the first pick are kept per draft
// and put back after the thread is sent or the bot is removed. localStorage
// keeps them across the reload or navigation that often follows a send.
function stash(prefix: string) {
  const name = (key: string) => `bb-launcher:${prefix}:${key}`;
  return {
    get(key: string): ComposerSelection | undefined {
      try { const raw = localStorage.getItem(name(key)); return raw ? JSON.parse(raw) as ComposerSelection : undefined; } catch { return undefined; }
    },
    has: (key: string) => localStorage.getItem(name(key)) !== null,
    set: (key: string, value: ComposerSelection) => localStorage.setItem(name(key), JSON.stringify(value)),
    delete: (key: string) => localStorage.removeItem(name(key)),
  };
}
const saved = stash("bot-saved-selection");
// Set on submit; the next chip mount restores it when the send unmounted the chip first.
const pendingRestore = stash("bot-pending-restore");

function hostOf(selection: ComposerSelection | null) {
  const environment = selection?.environment;
  return environment?.type === "host" ? environment.hostId
    : environment?.type === "provider" && environment.machine?.type === "existing" ? environment.machine.hostId : undefined;
}

function selectionFor(bot: Bot, current: ComposerSelection | null): ComposerSelection {
  const hostId = hostOf(current);
  const machine = hostId ? { machine: { type: "existing" as const, hostId } } : {};
  const environment: ComposerSelection["environment"] =
    bot.environment === "named-worktree" ? { type: "provider", environmentProviderId: PROVIDER_ID, inputs: null, ...machine }
    : bot.environment === "existing-branch" ? { type: "provider", environmentProviderId: EXISTING_PROVIDER_ID, inputs: null, ...machine }
    : bot.environment === "checkout" && hostId ? { type: "host", hostId, workspace: { type: "unmanaged", path: null } }
    : undefined;
  return {
    ...(bot.projectId ? { projectId: bot.projectId } : {}),
    ...(environment ? { environment } : {}),
    ...(bot.model ? { providerId: bot.model.providerId, model: bot.model.model, reasoningLevel: bot.model.reasoningLevel, serviceTier: bot.model.serviceTier } : {}),
    ...(bot.permissionMode ? { permissionMode: bot.permissionMode } : {}),
  };
}

const restore = (composer: PluginComposerApi, selection: ComposerSelection) => composer.setSelection(selection);

async function chooseBot(composer: PluginComposerApi, pluginId: string, bot: Bot | null) {
  const key = composer.key;
  composer.replace((draft) => draftWithBot(draft, bot, pluginId));
  if (!bot) {
    const previous = saved.get(key);
    saved.delete(key);
    if (previous) await restore(composer, previous).catch(() => {});
    return;
  }
  if (!saved.has(key) && composer.selection) saved.set(key, composer.selection);
  const next = selectionFor(bot, composer.selection);
  // Keep the Named worktree default from overriding the bot's environment after a project switch.
  if (next.projectId) markEnvironmentApplied(key, next.projectId);
  await composer.setSelection(next).catch(() => {});
}

export function BotChip() {
  const composer = useComposer();
  const pluginId = usePluginId();
  const bots = useBots();
  const key = composer.key;
  const botId = draftBotId(composer.draft, pluginId);
  const bot = botId ? bots?.find((item) => item.id === botId) ?? null : null;

  useEffect(() => {
    if (isOverlay(composer)) return;
    const pending = pendingRestore.get(key);
    if (pending && !draftBotId(composer.draft, pluginId)) {
      pendingRestore.delete(key);
      void restore(composer, pending).catch(() => {});
    }
    return composer.onSubmitted(() => {
      const previous = saved.get(key);
      if (!previous) return;
      saved.delete(key);
      pendingRestore.set(key, previous);
      void restore(composer, previous).then(() => pendingRestore.delete(key), () => {});
    });
  }, [composer, key, pluginId]);

  if (isOverlay(composer) || composer.scope.kind !== "new-thread" || !bots || bots.length === 0) return null;
  return (
    <button type="button" aria-label={bot ? `Bot: ${bot.name}` : "Choose a bot"} title="Start as a bot"
      onMouseDown={(e) => e.preventDefault()} onClick={() => composer.experimental_openPopup(BOT_POPUP_ID)}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 200, padding: "4px 8px", border: "none", borderRadius: 8,
        background: "transparent", color: bot ? "var(--foreground)" : "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
      {bot ? <BotAvatar bot={bot} size={16} /> : <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>☺</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot ? bot.name : "Bot"}</span>
      <span aria-hidden style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
    </button>
  );
}

type Row = { bot: Bot } | { bot: null };

export function BotPopup() {
  const composer = useComposer();
  const pluginId = usePluginId();
  const bots = useBots();
  const current = draftBotId(composer.draft, pluginId);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo<Row[]>(() => [
    ...filterBots(bots ?? [], query).map((bot) => ({ bot })),
    ...(current && (query === "" || "no bot".includes(query.trim().toLowerCase())) ? [{ bot: null }] : []),
  ], [bots, query, current]);

  useEffect(() => { setActive(Math.max(0, rows.findIndex((row) => row.bot?.id === current))); }, [bots]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const close = () => { composer.experimental_closePopup(); composer.focus(); };
  const choose = (row: Row | undefined) => {
    if (!row) return;
    composer.experimental_closePopup();
    void chooseBot(composer, pluginId, row.bot).then(() => composer.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const down = event.key === "ArrowDown" || (event.ctrlKey && (event.key === "n" || event.key === "j"));
    const up = event.key === "ArrowUp" || (event.ctrlKey && (event.key === "p" || event.key === "k"));
    if (down || up) {
      event.preventDefault();
      if (rows.length > 0) setActive((i) => (i + (down ? 1 : -1) + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 280, maxHeight: 320 }}>
      <input autoFocus value={query} placeholder="Start as a bot…" aria-label="Search bots"
        onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
        style={{ padding: "8px 12px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", fontSize: 13, outline: "none" }} />
      <div ref={listRef} role="listbox" aria-label="Bots" style={{ overflowY: "auto", padding: 4 }}>
        {rows.length === 0 && <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--muted-foreground)" }}>{bots === null ? "Loading…" : "No matching bots"}</div>}
        {rows.map((row, index) => (
          <div key={row.bot?.id ?? "none"} role="option" data-index={index} aria-selected={index === active}
            onMouseEnter={() => setActive(index)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(row)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 13,
              color: "var(--foreground)", background: index === active ? "var(--accent)" : "transparent" }}>
            {row.bot ? <BotAvatar bot={row.bot} size={18} /> : null}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.bot ? row.bot.name : "No bot"}</span>
            {row.bot && row.bot.id === current && <span style={{ color: "var(--muted-foreground)" }}>current</span>}
            {!row.bot && <span style={{ color: "var(--muted-foreground)" }}>restore the earlier settings</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
