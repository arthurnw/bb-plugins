// Moves tracked avatars' eyes toward the pointer. One pointermove listener and
// one requestAnimationFrame loop serve every tracked avatar, attached only while
// at least one is mounted. The loop runs while the pointer moves or eyes are
// still easing, then stops. Ported from the prototype.

interface Tracked {
  svg: SVGSVGElement;
  target: SVGGraphicsElement;
  /** Rest position and reach, from the target's data-x/y/kx/ky. */
  bx: number; by: number; kx: number; ky: number;
  lx: number; ly: number;
  px?: string; py?: string;
  rect: DOMRect | null;
  visible: boolean;
}

const RECENTER_MS = 2500;
const tracked = new Map<SVGSVGElement, Tracked>();
let pointerX = 0, pointerY = 0, following = false, running = false, recenter = 0;
let observer: IntersectionObserver | null = null;
let reducedMotion: MediaQueryList | null = null;

const invalidate = () => { for (const a of tracked.values()) a.rect = null; };

function kick() {
  if (running) return;
  running = true;
  // Panels open and resize without a scroll or resize event; measure again each time the loop starts.
  invalidate();
  requestAnimationFrame(loop);
}

function onPointerMove(event: PointerEvent) {
  if (reducedMotion?.matches) return;
  pointerX = event.clientX;
  pointerY = event.clientY;
  following = true;
  clearTimeout(recenter);
  recenter = window.setTimeout(() => { following = false; kick(); }, RECENTER_MS);
  kick();
}

function loop() {
  let moving = false;
  for (const a of tracked.values()) {
    if (!a.visible) continue;
    const r = a.rect ?? (a.rect = a.svg.getBoundingClientRect());
    let tx = 0, ty = 0;
    if (following) {
      const vx = pointerX - (r.left + r.width / 2), vy = pointerY - (r.top + r.height / 2);
      const d = Math.hypot(vx, vy) || 1, k = Math.min(1, d / (r.width * .8 + 30));
      tx = vx / d * k; ty = vy / d * k;
    }
    a.lx += (tx - a.lx) * .25; a.ly += (ty - a.ly) * .25;
    if (Math.abs(tx - a.lx) > .004 || Math.abs(ty - a.ly) > .004) moving = true;
    const x = (a.bx + a.lx * a.kx).toFixed(1), y = (a.by + a.ly * a.ky).toFixed(1);
    if (x !== a.px || y !== a.py) { a.target.setAttribute("transform", `translate(${x} ${y})`); a.px = x; a.py = y; }
  }
  if (moving) requestAnimationFrame(loop); else running = false;
}

function attach() {
  reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const a = tracked.get(entry.target as SVGSVGElement);
      if (a) { a.visible = entry.isIntersecting; a.rect = null; }
    }
  });
  addEventListener("pointermove", onPointerMove, { passive: true });
  addEventListener("scroll", invalidate, { passive: true, capture: true });
  addEventListener("resize", invalidate);
}

function detach() {
  removeEventListener("pointermove", onPointerMove);
  removeEventListener("scroll", invalidate, { capture: true });
  removeEventListener("resize", invalidate);
  observer?.disconnect();
  observer = null;
  clearTimeout(recenter);
  following = false;
}

/** Starts eye tracking for one rendered avatar; returns the cleanup. */
export function trackAvatar(svg: SVGSVGElement): () => void {
  const target = svg.querySelector<SVGGraphicsElement>(".track");
  if (!target) return () => {};
  const data = target.dataset;
  if (tracked.size === 0) attach();
  tracked.set(svg, { svg, target, bx: Number(data.x), by: Number(data.y), kx: Number(data.kx), ky: Number(data.ky), lx: 0, ly: 0, rect: null, visible: false });
  observer!.observe(svg);
  return () => {
    target.setAttribute("transform", `translate(${data.x} ${data.y})`);
    observer?.unobserve(svg);
    tracked.delete(svg);
    if (tracked.size === 0) detach();
  };
}
