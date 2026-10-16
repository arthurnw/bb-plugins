// The inbox's motion: counts that roll to their new value, rows that glide
// to their new place when the order changes, and clocks that tick.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** A number whose digits roll vertically when it changes. */
export function RollingNumber({ value }: { value: number }) {
  const digits = String(Math.max(0, Math.floor(value))).split("");
  return (
    <span className="bb-inbox-roll" aria-label={String(value)}>
      {digits.map((digit, index) => (
        // Keyed from the right, so 9 → 10 rolls the ones column and adds a tens column.
        <span key={digits.length - index} className="bb-inbox-roll-column" aria-hidden>
          <span className="bb-inbox-roll-strip" style={{ transform: `translateY(-${Number(digit) * 10}%)` }}>
            {"0123456789".split("").map((d) => (
              <span key={d}>{d}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Animates children carrying `data-flip-id` from their old position to their
 * new one whenever `order` changes (FLIP). Height changes from a row opening
 * do not change `order`, so they never trigger a glide.
 */
export function useFlip(container: RefObject<HTMLElement | null>, order: string) {
  const lastOrder = useRef<string | null>(null);
  const snapshot = useRef<Map<string, number> | null>(null);
  // The old positions are read during render, while the DOM still has them.
  // getBoundingClientRect includes running glides, so an interrupted glide
  // continues from where it is.
  if (order !== lastOrder.current) {
    snapshot.current = container.current === null ? null : measure(container.current);
  }
  useLayoutEffect(() => {
    const root = container.current;
    const previous = snapshot.current;
    const firstRender = lastOrder.current === null;
    lastOrder.current = order;
    snapshot.current = null;
    if (root === null || previous === null || prefersReducedMotion()) return;
    const rootTop = root.getBoundingClientRect().top;
    for (const item of items(root)) {
      const id = item.dataset.flipId!;
      const before = previous.get(id);
      if (before === undefined) {
        if (!firstRender) {
          item.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], {
            duration: 220,
            easing: "ease-out",
          });
        }
        continue;
      }
      for (const running of item.getAnimations()) running.cancel();
      const delta = before - (item.getBoundingClientRect().top - rootTop);
      if (Math.abs(delta) < 1) continue;
      item.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], {
        duration: 420,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
    }
    // Glides run only when the order changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);
}

const items = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("[data-flip-id]"));

function measure(root: HTMLElement): Map<string, number> {
  const rootTop = root.getBoundingClientRect().top;
  return new Map(items(root).map((item) => [item.dataset.flipId!, item.getBoundingClientRect().top - rootTop]));
}

/** The current time, updated every `intervalMs` while `active`. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
