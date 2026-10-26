// Ctrl+N / Ctrl+P move through bb's pickers, as in macOS text fields. bb's
// pickers read `event.key`, so the chord is replaced with a synthetic
// ArrowDown / ArrowUp on the same target.

const PICKER = [
  "[role='combobox']",
  "[aria-autocomplete='list']",
  "[aria-activedescendant]",
  "[cmdk-input]",
  "[role='listbox']",
  "[role='menu']",
].join(", ");

const ARROWS: Record<string, { key: string; keyCode: number }> = {
  KeyN: { key: "ArrowDown", keyCode: 40 },
  KeyP: { key: "ArrowUp", keyCode: 38 },
};

// The composer's `/` and `@` menus render inside the composer while open.
function composerMenuOpen(target: Element): boolean {
  const menu = target.closest("[data-app-composer]")?.querySelector("[data-promptbox-typeahead-menu]");
  return menu != null && menu.childElementCount > 0;
}

function inPicker(target: Element): boolean {
  if (target.closest(".ProseMirror")) return composerMenuOpen(target);
  return target.closest(PICKER) !== null;
}

/** Returns true when the event was a Ctrl+N / Ctrl+P handled for a picker. */
export function handlePickerKey(event: KeyboardEvent): boolean {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const arrow = ARROWS[event.code];
  const target = event.target;
  if (arrow === undefined || !(target instanceof Element) || !inPicker(target)) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  target.dispatchEvent(
    new KeyboardEvent("keydown", { ...arrow, code: arrow.key, bubbles: true, cancelable: true, composed: true }),
  );
  return true;
}
