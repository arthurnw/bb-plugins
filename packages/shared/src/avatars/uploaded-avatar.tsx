// Uploaded avatars. An animated upload shows its still first frame when idle and
// plays while the bot is working, unread, or waiting. The animated bytes are
// fetched only when first needed, through the fetcher the host plugin sets.
import { useEffect, useInsertionEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { dataUrlBytes } from "./animation.ts";
import { injectAvatarStyles } from "./avatar.css.ts";
import { ask, badge } from "./gallery.ts";
import type { AvatarState } from "./state.ts";

type Fetcher = (botId: string) => Promise<string | null>;
let setFetcher!: (fetcher: Fetcher) => void;
let fetcher = new Promise<Fetcher>((resolve) => { setFetcher = resolve; });

/** How this bundle reads animated uploads (Bots' `getBotAvatarAnimation`). Until it is set, uploads stay still. */
export function setAnimationFetcher(next: Fetcher) {
  setFetcher(next);
  fetcher = Promise.resolve(next);
}

/** Bot id → an object URL for one version of its animation. A newer version revokes the older URL. */
const cache = new Map<string, { version: string; url: Promise<string | null> }>();

function animationUrl(botId: string, version: string): Promise<string | null> {
  const hit = cache.get(botId);
  if (hit?.version === version) return hit.url;
  if (hit) void hit.url.then((url) => { if (url) URL.revokeObjectURL(url); });
  const entry = { version, url: fetcher.then((fetch) => fetch(botId)).then((dataUrl) => {
    if (!dataUrl) return null;
    const type = dataUrl.slice("data:".length, dataUrl.indexOf(";"));
    return URL.createObjectURL(new Blob([dataUrlBytes(dataUrl) as Uint8Array<ArrayBuffer>], { type }));
  }).catch(() => {
    // Retry on the next mount rather than keep the failure.
    if (cache.get(botId) === entry) cache.delete(botId);
    return null;
  }) };
  cache.set(botId, entry);
  return entry.url;
}

let motionQuery: MediaQueryList | null = null;
const reducedMotionQuery = () => motionQuery ??= matchMedia("(prefers-reduced-motion: reduce)");
const subscribeMotion = (listener: () => void) => {
  const query = reducedMotionQuery();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const useReducedMotion = () => useSyncExternalStore(subscribeMotion, () => reducedMotionQuery().matches, () => false);

const MOVING = new Set<AvatarState>(["working", "unread", "waiting"]);
const OVERLAY = { __html: badge + ask("smooth") };

/**
 * An uploaded image cropped to a circle. With `animation` (the bot's
 * `avatarAnimation` version) and a non-idle state it plays the animation; with
 * reduced motion it stays still and shows the gallery's unread badge and
 * waiting bubble instead.
 */
export function UploadedAvatar({ src, botId, animation, state = "idle", box, className }: {
  src: string; botId?: string; animation?: string | null; state?: AvatarState; box: CSSProperties; className?: string;
}) {
  const reduced = useReducedMotion();
  const play = Boolean(botId && animation) && MOVING.has(state) && !reduced;
  const [playing, setPlaying] = useState<string | null>(null);
  useInsertionEffect(injectAvatarStyles, []);
  useEffect(() => {
    setPlaying(null);
    if (!play) return;
    let live = true;
    void animationUrl(botId!, animation!).then((url) => { if (live) setPlaying(url); });
    return () => { live = false; };
  }, [play, botId, animation]);
  if (!animation) return <img src={src} alt="" aria-hidden className={className} style={{ ...box, objectFit: "cover" }} />;
  const { borderRadius, overflow, ...outer } = box;
  return (
    <span aria-hidden className={className} style={{ ...outer, position: "relative" }}>
      <img src={playing ?? src} alt="" style={{ width: "100%", height: "100%", borderRadius, overflow, objectFit: "cover" }} />
      <svg viewBox="0 0 96 96" className={`bb-av st-${state}`} dangerouslySetInnerHTML={OVERLAY}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
    </span>
  );
}
