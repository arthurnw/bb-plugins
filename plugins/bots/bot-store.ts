import { createHash, randomUUID } from "node:crypto";
import { animatedImageType, ANIMATION_DATA_URL, ANIMATION_MAX_CHARS, AVATAR_DATA_URL, AVATAR_MAX_CHARS, dataUrlBytes, GALLERY_IDS, galleryAvatar, galleryId, MAX_BOTS, MEMORY_MAX, type BindingSource, type Bot, type BotDraft, DEFAULT_AVATAR_CORNER, type OwnerLookup } from "@arthurnw/bb-shared/bots";

/** The subset of better-sqlite3 (and node:sqlite, for tests) the store uses. */
export interface SqlDb {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

// Append-only: bb.storage.migrate rejects edited or reordered statements.
export const MIGRATIONS = [
  `CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    draft_json TEXT NOT NULL,
    memory TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE bot_threads (
    thread_id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE bot_detached (thread_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`,
  `ALTER TABLE bots ADD COLUMN avatar TEXT`,
  `ALTER TABLE bots ADD COLUMN avatar_slot INTEGER`,
  // Apart from `bots` so loading and listing bots never reads the animated bytes.
  `CREATE TABLE bot_avatar_animations (bot_id TEXT PRIMARY KEY, data TEXT NOT NULL, version TEXT NOT NULL)`,
];

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export class BotStoreError extends Error {}

type BotRow = { id: string; position: number; draft_json: string; memory: string; avatar: string | null; avatar_slot: number | null; created_at: number; updated_at: number;
  /** From bot_avatar_animations. */
  avatar_animation?: string | null };

/**
 * Bots and thread bindings. SQLite is the durable copy; the maps are the read
 * path because `bb.agents.configure` is synchronous and on the thread-start path.
 */
export class BotStore implements OwnerLookup {
  private bots = new Map<string, Bot>();
  private bindings = new Map<string, string>();
  private detachedThreads = new Set<string>();
  private db: SqlDb;
  private now: () => number;

  constructor(db: SqlDb, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    const rows = db.prepare("SELECT * FROM bots").all() as BotRow[];
    const animations = new Map((db.prepare("SELECT bot_id, version FROM bot_avatar_animations").all() as { bot_id: string; version: string }[])
      .map((row) => [row.bot_id, row.version]));
    for (const row of rows) row.avatar_animation = animations.get(row.id) ?? null;
    for (const row of rows) if (row.avatar_slot !== null) this.bots.set(row.id, fromRow(row, row.avatar_slot));
    // Bots created before avatars existed get a slot on first load.
    for (const row of rows) {
      if (row.avatar_slot !== null) continue;
      const slot = this.freeSlot();
      db.prepare("UPDATE bots SET avatar_slot = ? WHERE id = ?").run(slot, row.id);
      this.bots.set(row.id, fromRow(row, slot));
    }
    for (const row of db.prepare("SELECT thread_id, bot_id FROM bot_threads").all() as { thread_id: string; bot_id: string }[]) {
      this.bindings.set(row.thread_id, row.bot_id);
    }
    for (const row of db.prepare("SELECT thread_id FROM bot_detached").all() as { thread_id: string }[]) this.detachedThreads.add(row.thread_id);
  }

  list(): Bot[] {
    return [...this.bots.values()].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
  }
  get(botId: string): Bot | null {
    return this.bots.get(botId) ?? null;
  }
  require(botId: string): Bot {
    const bot = this.get(botId);
    if (!bot) throw new BotStoreError("That bot no longer exists.");
    return bot;
  }

  save(botId: string | undefined, draft: BotDraft): Bot {
    const clash = this.list().find((bot) => bot.id !== botId && bot.name.toLowerCase() === draft.name.toLowerCase());
    if (clash) throw new BotStoreError(`A bot named "${clash.name}" already exists.`);
    const at = this.now();
    if (botId === undefined) {
      if (this.bots.size >= MAX_BOTS) throw new BotStoreError(`You can have up to ${MAX_BOTS} bots.`);
      const position = Math.max(-1, ...[...this.bots.values()].map((bot) => bot.position)) + 1;
      const bot: Bot = { ...draft, id: randomUUID(), position, memory: "", avatar: this.freshAvatar(), avatarAnimation: null, avatarSlot: this.freeSlot(), createdAt: at, updatedAt: at };
      this.db.prepare("INSERT INTO bots (id, position, draft_json, memory, avatar, avatar_slot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(bot.id, bot.position, JSON.stringify(draft), "", bot.avatar, bot.avatarSlot, at, at);
      this.bots.set(bot.id, bot);
      return bot;
    }
    const bot: Bot = { ...this.require(botId), ...draft, updatedAt: at };
    this.db.prepare("UPDATE bots SET draft_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(draft), at, botId);
    this.bots.set(botId, bot);
    return bot;
  }

  /** `animation` is an animated upload whose still first frame is `avatar`; null removes any earlier one. */
  setAvatar(botId: string, avatar: string | null, animation: string | null = null): Bot {
    if (avatar !== null && !galleryId(avatar) && (avatar.length > AVATAR_MAX_CHARS || !AVATAR_DATA_URL.test(avatar))) {
      throw new BotStoreError("The avatar must be a built-in avatar or a small PNG, JPEG, or WebP image.");
    }
    if (animation !== null) checkAnimation(avatar, animation);
    const current = this.require(botId);
    const at = this.now();
    this.db.prepare("UPDATE bots SET avatar = ?, updated_at = ? WHERE id = ?").run(avatar, at, botId);
    const version = animation === null ? null : sha256(animation).slice(0, 16);
    if (version === null) this.db.prepare("DELETE FROM bot_avatar_animations WHERE bot_id = ?").run(botId);
    else this.db.prepare("INSERT INTO bot_avatar_animations (bot_id, data, version) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET data = excluded.data, version = excluded.version")
      .run(botId, animation, version);
    const bot: Bot = { ...current, avatar, avatarAnimation: version, updatedAt: at };
    this.bots.set(botId, bot);
    return bot;
  }

  /** The bot's animated upload as a data URL, or null. */
  animation(botId: string): string | null {
    if (!this.get(botId)?.avatarAnimation) return null;
    const [row] = this.db.prepare("SELECT data FROM bot_avatar_animations WHERE bot_id = ?").all(botId) as { data: string }[];
    return row?.data ?? null;
  }

  /** A random gallery avatar, preferring one no other bot uses. */
  private freshAvatar(): string {
    const used = new Set([...this.bots.values()].map((bot) => galleryId(bot.avatar)));
    const unused = GALLERY_IDS.filter((id) => !used.has(id));
    const pool = unused.length > 0 ? unused : GALLERY_IDS;
    return galleryAvatar(pool[Math.floor(Math.random() * pool.length)]!);
  }

  private freeSlot(): number {
    const used = new Set([...this.bots.values()].map((bot) => bot.avatarSlot));
    for (let slot = 0; slot < MAX_BOTS; slot++) if (!used.has(slot)) return slot;
    throw new BotStoreError(`You can have up to ${MAX_BOTS} bots.`);
  }

  delete(botId: string): boolean {
    if (!this.bots.has(botId)) return false;
    this.db.prepare("DELETE FROM bots WHERE id = ?").run(botId);
    this.db.prepare("DELETE FROM bot_avatar_animations WHERE bot_id = ?").run(botId);
    this.bots.delete(botId);
    return true;
  }

  /** Bots missing from `botIds` keep their relative order after the listed ones. */
  reorder(botIds: readonly string[]): Bot[] {
    const listed = botIds.filter((id, i) => this.bots.has(id) && botIds.indexOf(id) === i);
    const order = [...listed, ...this.list().map((bot) => bot.id).filter((id) => !listed.includes(id))];
    const update = this.db.prepare("UPDATE bots SET position = ? WHERE id = ?");
    order.forEach((id, position) => {
      update.run(position, id);
      this.bots.set(id, { ...this.bots.get(id)!, position });
    });
    return this.list();
  }

  memory(botId: string) {
    const { memory } = this.require(botId);
    return { content: memory, sha256: sha256(memory), limit: MEMORY_MAX };
  }

  setMemory(botId: string, content: string, expectedSha256: string) {
    const bot = this.require(botId);
    if (sha256(bot.memory) !== expectedSha256) throw new BotStoreError("Memory changed since it was read. Read it again and retry.");
    if (content.length > MEMORY_MAX) throw new BotStoreError(`Memory is limited to ${MEMORY_MAX} characters.`);
    const at = this.now();
    this.db.prepare("UPDATE bots SET memory = ?, updated_at = ? WHERE id = ?").run(content, at, botId);
    this.bots.set(botId, { ...bot, memory: content, updatedAt: at });
    return this.memory(botId);
  }

  /** A binding to a deleted bot reads as no binding, so configure returns nothing for it. */
  binding(threadId: string): string | null {
    const botId = this.bindings.get(threadId);
    return botId !== undefined && this.bots.has(botId) ? botId : null;
  }
  /** True when the thread has a row, even for a deleted bot. Such threads do not inherit again. */
  hasBinding(threadId: string): boolean {
    return this.bindings.has(threadId);
  }
  detached(threadId: string): boolean {
    return this.detachedThreads.has(threadId);
  }

  bind(threadId: string, botId: string, source: BindingSource) {
    this.require(botId);
    this.db.prepare("INSERT INTO bot_threads (thread_id, bot_id, source, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET bot_id = excluded.bot_id, source = excluded.source")
      .run(threadId, botId, source, this.now());
    this.db.prepare("DELETE FROM bot_detached WHERE thread_id = ?").run(threadId);
    this.bindings.set(threadId, botId);
    this.detachedThreads.delete(threadId);
  }

  detach(threadId: string) {
    this.db.prepare("DELETE FROM bot_threads WHERE thread_id = ?").run(threadId);
    this.db.prepare("INSERT OR IGNORE INTO bot_detached (thread_id, created_at) VALUES (?, ?)").run(threadId, this.now());
    this.bindings.delete(threadId);
    this.detachedThreads.add(threadId);
  }

  forget(threadId: string) {
    this.db.prepare("DELETE FROM bot_threads WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM bot_detached WHERE thread_id = ?").run(threadId);
    this.bindings.delete(threadId);
    this.detachedThreads.delete(threadId);
  }

  /** Every thread with a binding or a "No bot" row. */
  boundThreadIds(): string[] {
    return [...new Set([...this.bindings.keys(), ...this.detachedThreads])];
  }

  /** Thread id → bot id, for live bots only. */
  threadBots(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [threadId, botId] of this.bindings) if (this.bots.has(botId)) result[threadId] = botId;
    return result;
  }
}

function checkAnimation(avatar: string | null, animation: string) {
  if (avatar === null || galleryId(avatar)) throw new BotStoreError("An animated avatar needs its still first frame.");
  if (animation.length > ANIMATION_MAX_CHARS || !ANIMATION_DATA_URL.test(animation)) {
    throw new BotStoreError("Animated avatars must be a GIF, WebP, or PNG of at most 1 MB.");
  }
  const declared = animation.slice("data:".length, animation.indexOf(";"));
  if (animatedImageType(dataUrlBytes(animation)) !== declared) throw new BotStoreError("That file is not an animated GIF, WebP, or PNG.");
}

function fromRow(row: BotRow, avatarSlot: number): Bot {
  // Drafts saved before a field existed get its default.
  const draft = { memoryWrites: true, avatarCorner: DEFAULT_AVATAR_CORNER, ...(JSON.parse(row.draft_json) as Partial<BotDraft>) } as BotDraft;
  return { ...draft, id: row.id, position: row.position, memory: row.memory, avatar: row.avatar, avatarAnimation: row.avatar_animation ?? null, avatarSlot,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
