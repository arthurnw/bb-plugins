import type { CSSProperties } from "react";
import type { Bot } from "../bots.ts";
import { AnimatedAvatar } from "../avatars/animated-avatar.tsx";
import { GALLERY_PREFIX, galleryId } from "../avatars/ids.ts";

export type Face = Pick<Bot, "avatar" | "emoji" | "name">;

/** Gallery avatar, else image, else emoji, else the first letter of the name. Only the last three are cropped to a circle. */
export function BotAvatar({ bot, size, className }: { bot: Face | null | undefined; size?: number; className?: string }) {
  const gallery = galleryId(bot?.avatar);
  if (gallery) return <AnimatedAvatar id={gallery} size={size} className={className} />;
  const box: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", borderRadius: "50%", overflow: "hidden",
    ...(size ? { width: size, height: size, fontSize: size * 0.7 } : { width: "1em", height: "1em" }), lineHeight: 1,
  };
  if (bot?.avatar && !bot.avatar.startsWith(GALLERY_PREFIX)) return <img src={bot.avatar} alt="" aria-hidden className={className} style={{ ...box, objectFit: "cover" }} />;
  if (bot?.emoji) return <span aria-hidden className={className} style={box}>{bot.emoji}</span>;
  const initial = bot?.name.trim().charAt(0).toUpperCase() || "?";
  return <span aria-hidden className={className} style={{ ...box, background: "var(--muted)", color: "var(--muted-foreground)", fontWeight: 600, fontSize: size ? size * 0.55 : "0.65em" }}>{initial}</span>;
}
