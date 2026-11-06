import type { CSSProperties } from "react";
import type { Bot } from "../bots.ts";
import { AnimatedAvatar } from "./animated-avatar.tsx";
import { GALLERY_PREFIX, galleryId } from "./ids.ts";
import type { AvatarState } from "./state.ts";
import { UploadedAvatar } from "./uploaded-avatar.tsx";

/** `id` and `avatarAnimation` let an animated upload play. */
export type Face = Pick<Bot, "avatar" | "emoji" | "name"> & Partial<Pick<Bot, "id" | "avatarAnimation">>;

/**
 * Gallery avatar, else image, else emoji, else the first letter of the name.
 * Only the last three are cropped to a circle. `state` applies to gallery
 * avatars and animated uploads; `track` to gallery avatars.
 */
export function BotAvatar({ bot, size, className, state = "idle", track = false }: {
  bot: Face | null | undefined; size?: number; className?: string; state?: AvatarState; track?: boolean;
}) {
  const gallery = galleryId(bot?.avatar);
  if (gallery) return <AnimatedAvatar id={gallery} size={size} className={className} state={state} track={track} />;
  const box: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", borderRadius: "50%", overflow: "hidden",
    ...(size ? { width: size, height: size, fontSize: size * 0.7 } : { width: "1em", height: "1em" }), lineHeight: 1,
  };
  if (bot?.avatar && !bot.avatar.startsWith(GALLERY_PREFIX)) {
    return <UploadedAvatar src={bot.avatar} botId={bot.id} animation={bot.avatarAnimation} state={state} box={box} className={className} />;
  }
  if (bot?.emoji) return <span aria-hidden className={className} style={box}>{bot.emoji}</span>;
  const initial = bot?.name.trim().charAt(0).toUpperCase() || "?";
  return <span aria-hidden className={className} style={{ ...box, background: "var(--muted)", color: "var(--muted-foreground)", fontWeight: 600, fontSize: size ? size * 0.55 : "0.65em" }}>{initial}</span>;
}
