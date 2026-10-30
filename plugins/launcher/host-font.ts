import { useEffect, useState } from "react";

/** The font size of the host's own dropdown buttons beside `el`, so plugin fields match them on any screen. */
export function hostFontSize(el: HTMLElement): string | null {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const button = [...parent.querySelectorAll("button")].find((b) => !el.contains(b) && !b.contains(el) && !b.closest("[data-launcher-field]") && b.textContent?.trim());
    if (button) return getComputedStyle(button).fontSize;
  }
  return null;
}

export function useHostFontSize(ref: { current: HTMLElement | null }, fallback = "12px") {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    if (ref.current) setSize(hostFontSize(ref.current) ?? fallback);
  }, [ref, fallback]);
  return size;
}
