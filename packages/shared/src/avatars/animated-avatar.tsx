import { useId, useInsertionEffect, useMemo, useState, type CSSProperties } from "react";
import { injectAvatarStyles } from "./avatar.css.ts";
import { ask, GALLERY } from "./gallery.ts";
import type { GalleryId } from "./ids.ts";

const seconds = (min: number, max: number) => `${(min + Math.random() * (max - min)).toFixed(2)}s`;

/** A gallery avatar drawn as inline SVG. Not cropped: motion can leave the box. */
export function AnimatedAvatar({ id, size, className }: { id: GalleryId; size?: number; className?: string }) {
  const def = GALLERY[id];
  // useId returns characters such as ":" or "«" that do not belong in url(#…).
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  useInsertionEffect(injectAvatarStyles, []);
  // Random offsets keep avatars on screen together from blinking and breathing in step.
  const [timing] = useState(() => ({ "--bd": `-${seconds(0, 6)}`, "--blink": seconds(4, 7), "--ph": `-${seconds(0, 3)}` }) as CSSProperties);
  const markup = useMemo(() => ({ __html: def.body(uid) + ask(def.style) }), [def, uid]);
  const box = size ?? "1em";
  return (
    <svg viewBox="0 0 96 96" width={box} height={box} aria-hidden style={timing} dangerouslySetInnerHTML={markup}
      className={`bb-av av-${def.style} av-${def.id} st-idle${className ? ` ${className}` : ""}`} />
  );
}
