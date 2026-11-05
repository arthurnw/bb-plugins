// Text fields currently mounted for one environment option, so a command can focus one. A request
// made before the field mounts (the environment was just switched) is kept briefly and claimed by
// the first matching field that mounts.
function visible(el: HTMLElement) {
  return el.isConnected && el.getClientRects().length > 0;
}

export function createFocusRegistry() {
  const fields = new Map<HTMLElement, (() => void) | undefined>();
  let pending: { within: (el: HTMLElement) => boolean; until: number } | null = null;

  /** Focuses a visible field matching `within`; returns false when none is mounted yet. */
  function focus(within: (el: HTMLElement) => boolean, waitMs = 0): boolean {
    const field = [...fields.keys()].reverse().find((el) => visible(el) && within(el));
    if (field) {
      pending = null;
      field.focus();
      if (field instanceof HTMLInputElement) field.setSelectionRange(field.value.length, field.value.length);
      fields.get(field)?.();
      return true;
    }
    pending = waitMs > 0 ? { within, until: Date.now() + waitMs } : null;
    return false;
  }

  /** Whether a visible field matching `within` is mounted. */
  const shown = (within: (el: HTMLElement) => boolean) => [...fields.keys()].some((el) => visible(el) && within(el));

  /** Whether the focused element is a registered field matching `within`. */
  const focused = (within: (el: HTMLElement) => boolean) => [...fields.keys()].some((el) => el === document.activeElement && within(el));

  /** Registers a mounted field, with an optional callback run after a command focuses it; returns its cleanup. */
  function register(el: HTMLElement, onFocus?: () => void) {
    fields.set(el, onFocus);
    // Wait a frame so the field is laid out before checking visibility.
    const frame = requestAnimationFrame(() => {
      if (pending && pending.until > Date.now() && visible(el) && pending.within(el)) focus(pending.within);
    });
    return () => { cancelAnimationFrame(frame); fields.delete(el); };
  }

  return { focus, register, shown, focused };
}
