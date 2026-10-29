import { useSyncExternalStore } from "react";

const query = () => window.matchMedia("(max-width: 767px)");

/** Phone-sized screens. */
export function useIsCompactViewport(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = query();
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => query().matches,
  );
}
