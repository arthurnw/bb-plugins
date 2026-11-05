import { useEffect, useId, useInsertionEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { injectAvatarStyles } from "./avatar.css.ts";
import { ask, GALLERY } from "./gallery.ts";
import type { GalleryId } from "./ids.ts";
import type { AvatarState } from "./state.ts";
import { trackAvatar } from "./tracker.ts";

const seconds = (min: number, max: number) => `${(min + Math.random() * (max - min)).toFixed(2)}s`;

/**
 * A gallery avatar drawn as inline SVG. Not cropped: motion can leave the box.
 * `track` turns the eyes toward the pointer.
 */
export function AnimatedAvatar({ id, size, state = "idle", track = false, className }: {
  id: GalleryId; size?: number; state?: AvatarState; track?: boolean; className?: string;
}) {
  const def = GALLERY[id];
  // useId returns characters such as ":" or "«" that do not belong in url(#…).
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const ref = useRef<SVGSVGElement>(null);
  useInsertionEffect(injectAvatarStyles, []);
  // Random offsets keep avatars on screen together from blinking and breathing in step.
  const [timing] = useState(() => ({ "--bd": `-${seconds(0, 6)}`, "--blink": seconds(4, 7), "--ph": `-${seconds(0, 3)}` }) as CSSProperties);
  const markup = useMemo(() => ({ __html: def.body(uid) + ask(def.style) }), [def, uid]);
  useEffect(() => track && ref.current ? trackAvatar(ref.current) : undefined, [track, markup]);
  const box = size ?? "1em";
  return (
    <svg ref={ref} viewBox="0 0 96 96" width={box} height={box} aria-hidden style={timing} dangerouslySetInnerHTML={markup}
      className={`bb-av av-${def.style} av-${def.id} st-${state}${className ? ` ${className}` : ""}`} />
  );
}
