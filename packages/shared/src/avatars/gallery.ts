// Animated gallery avatars: the inner markup of a 96×96 SVG. Ported from the
// approved prototype (research/animated-avatars-prototype.html); do not redesign.
// Classes inside the markup are styled by avatar.css.ts, and elements with
// `.track` and data-x/y/kx/ky are moved by the cursor tracker.
import type { GalleryId } from "./ids.ts";

export type AvatarStyle = "smooth" | "geo";
export interface GalleryAvatar {
  id: GalleryId;
  label: string;
  style: AvatarStyle;
  /** `uid` makes clip path and mask ids unique per instance. */
  body: (uid: string) => string;
}

function mouths(y: number, ink: string, w = 4) {
  return `<path class="m-idle" d="M${-w} ${y} Q0 ${y + 5} ${w} ${y}" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path class="m-work" d="M${-w + 1} ${y + 2} H${w - 1}" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>
    <path class="m-unread" d="M${-w - 1} ${y - .5} Q0 ${y + 10} ${w + 1} ${y - .5} Z" fill="${ink}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>
    <ellipse class="m-wait" cx="0" cy="${y + 2.5}" rx="2.3" ry="2.9" fill="${ink}"/>`;
}

interface SmoothFace { y?: number; gap?: number; rx?: number; ry?: number; ink?: string; cheek?: string; cheekGap?: number; my?: number; kx?: number; ky?: number; extra?: string; under?: string; mouth?: boolean }
function smoothFace({ y = 56, gap = 11, rx = 3.8, ry = 4.8, ink = "#1b1b2a", cheek = "#ff8fa3", cheekGap = 19, my = 6, kx = 6, ky = 4, extra = "", under = "", mouth = true }: SmoothFace = {}) {
  const eye = (x: number) => `<g class="eye"><ellipse cx="${x}" cy="0" rx="${rx}" ry="${ry}" fill="${ink}"/><circle cx="${x - rx * .32}" cy="${-ry * .38}" r="${rx * .36}" fill="#fff"/></g>`;
  const cheeks = cheek ? `<ellipse cx="${-cheekGap}" cy="7" rx="4" ry="2.6" fill="${cheek}" opacity=".75"/><ellipse cx="${cheekGap}" cy="7" rx="4" ry="2.6" fill="${cheek}" opacity=".75"/>` : "";
  return `<g class="face track" data-x="48" data-y="${y}" data-kx="${kx}" data-ky="${ky}" transform="translate(48 ${y})">
    ${under}${cheeks}<g class="gaze">${eye(-gap)}${eye(gap)}</g>${mouth ? mouths(my, ink) : ""}${extra}</g>`;
}

interface GeoFace { x?: number; y?: number; gap?: number; r?: number; ink?: string; my?: number; kx?: number; ky?: number; w?: number }
function geoFace({ x = 48, y = 54, gap = 9, r = 4, ink = "#1b1b2a", my = 7, kx = 5, ky = 3, w = 4 }: GeoFace = {}) {
  const eye = (x: number) => `<g class="eye"><circle cx="${x}" cy="0" r="${r}" fill="${ink}"/><rect x="${x - r * .55}" y="${-r * .6}" width="${r * .5}" height="${r * .5}" fill="#fff"/></g>`;
  return `<g class="face track" data-x="${x}" data-y="${y}" data-kx="${kx}" data-ky="${ky}" transform="translate(${x} ${y})">
    <g class="gaze">${eye(-gap)}${eye(gap)}</g>${mouths(my, ink, w)}</g>`;
}

const shadow = (y = 87, rx = 26) => `<ellipse cx="48" cy="${y}" rx="${rx}" ry="3.5" fill="#000" opacity=".16"/>`;
const badge = `<circle class="badge" cx="82" cy="16" r="9" fill="#ff5d7a" stroke="#fff" stroke-width="3"/>`;

/** The question bubble shown while waiting; drawn last so it sits on top. */
export const ask = (style: AvatarStyle) => style === "geo"
  ? `<g class="ask"><path d="M70 24L66 31L75 26Z" fill="#ffd54a"/><rect x="68" y="2" width="22" height="22" rx="5" fill="#ffd54a"/><text x="79" y="19" text-anchor="middle" font-size="16" font-weight="800" font-family="system-ui, sans-serif" fill="#1b1b2a">?</text></g>`
  : `<g class="ask"><path d="M71 22L66 30L76 25Z" fill="#fff" stroke="#1b1b2a" stroke-width="2.2" stroke-linejoin="round"/><circle cx="79" cy="13" r="11" fill="#fff" stroke="#1b1b2a" stroke-width="2.2"/><path d="M70 23.5L74.5 21.5" stroke="#fff" stroke-width="3"/><text x="79" y="18.5" text-anchor="middle" font-size="15" font-weight="800" font-family="system-ui, sans-serif" fill="#1b1b2a">?</text></g>`;

function starPaths(cx: number, cy: number, R: number, r: number) {
  const pt = (rad: number, deg: number) => `${(cx + rad * Math.cos(deg * Math.PI / 180)).toFixed(1)} ${(cy + rad * Math.sin(deg * Math.PI / 180)).toFixed(1)}`;
  let outline = "";
  for (let i = 0; i < 5; i++) {
    const a = -90 + i * 72;
    outline += `${i ? "L" : "M"}${pt(R, a)}L${pt(r, a + 36)}`;
  }
  return outline + "Z";
}
const NOVA_OUTLINE = starPaths(48, 52, 38, 17);

const SMOOTH: GalleryAvatar[] = [
  { id: "bean", label: "Bean", style: "smooth", body: () => `${shadow()}<g class="body">
      <path d="M48 18C70 18 82 36 82 56C82 74 68 84 48 84C28 84 14 74 14 56C14 36 26 18 48 18Z" fill="#ff7a6b"/>
      <path d="M48 76C30 76 20 68 18 58C24 72 36 80 48 80C62 80 74 72 78 58C76 68 66 76 48 76Z" fill="#d54a3c"/>
      <ellipse cx="32" cy="34" rx="7" ry="4" fill="#ffd9d3" opacity=".75" transform="rotate(-30 32 34)"/>
      ${smoothFace({ y: 56 })}</g>${badge}` },
  { id: "sprout", label: "Sprout", style: "smooth", body: () => `${shadow(86, 32)}<g class="body">
      <g class="leaf"><path d="M48 34Q46.5 25 50 18" stroke="#2c9a77" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <path d="M50 19C55 9 68 9 72 13C67 22 57 23 50 19Z" fill="#7be0b5"/><path d="M49 23C44 15 35 15 31 18C36 25 44 26 49 23Z" fill="#5fd6a8"/></g>
      <path d="M21 83Q12 83 13 72C15 46 30 32 48 32C66 32 81 46 83 72Q84 83 75 83Z" fill="#4fd1a5"/>
      <path d="M13.3 70C14 79 17 83 21 83H75C79 83 82.7 79 82.8 70C80 77 70 78.5 48 78.5C26 78.5 16 77 13.3 70Z" fill="#2c9a77"/>
      <ellipse cx="31" cy="46" rx="6" ry="3.5" fill="#d3fbea" opacity=".75" transform="rotate(-32 31 46)"/>
      ${smoothFace({ y: 61, gap: 12, cheekGap: 21 })}</g>${badge}` },
  { id: "puff", label: "Puff", style: "smooth", body: () => `${shadow(87, 30)}<g class="body">
      <g class="rain" fill="#7cc4ff"><path class="drop" d="M36 74q2.5 4 0 5.5q-2.5-1.5 0-5.5Z"/><path class="drop" d="M50 76q2.5 4 0 5.5q-2.5-1.5 0-5.5Z"/><path class="drop" d="M63 74q2.5 4 0 5.5q-2.5-1.5 0-5.5Z"/></g>
      <path d="M26 72C12 72 8 54 22 48C20 32 40 22 52 32C62 20 82 30 78 48C92 52 88 72 72 72Z" fill="#8ccbff"/>
      <path d="M12.5 62C14 68 19 72 26 72H72C79 72 85 68 86.6 62C83 67 78 68 72 68H26C20 68 15.5 66.5 12.5 62Z" fill="#5aa8ee"/>
      <ellipse cx="35" cy="37" rx="6" ry="3.4" fill="#e6f4ff" opacity=".85" transform="rotate(-28 35 37)"/>
      ${smoothFace({ y: 52, gap: 10.5, cheekGap: 18, ry: 4.4, rx: 3.6 })}</g>${badge}` },
  { id: "inky", label: "Inky", style: "smooth", body: () => `${shadow(87, 28)}<g class="body">
      <g stroke="#e8659f" stroke-width="9" fill="none" stroke-linecap="round">
        <g class="t t1" style="transform-origin:27px 60px"><path d="M27 60Q22 71 24 80"/></g>
        <g class="t t2" style="transform-origin:41px 62px"><path d="M41 62Q39 73 41 82"/></g>
        <g class="t t3" style="transform-origin:55px 62px"><path d="M55 62Q57 73 55 82"/></g>
        <g class="t t4" style="transform-origin:69px 60px"><path d="M69 60Q74 71 72 80"/></g></g>
      <path d="M18 60C18 34 32 20 48 20C64 20 78 34 78 60C78 69 18 69 18 60Z" fill="#f27fb2"/>
      <path d="M18.2 57C19 64 30 66 48 66C66 66 77 64 77.8 57C78 60 78 61 78 61C78 69 18 69 18 61Z" fill="#d95c95"/>
      <circle cx="33" cy="31" r="3.2" fill="#ffc2dc"/><circle cx="62" cy="29" r="2.2" fill="#ffc2dc"/><circle cx="27" cy="41" r="1.8" fill="#ffc2dc"/>
      ${smoothFace({ y: 47, gap: 11, cheek: "#ff5c8a" })}</g>${badge}` },
  { id: "pebble", label: "Pebble", style: "smooth", body: () => `${shadow(87, 28)}<g class="body">
      <path d="M20 66C14 48 26 26 50 24C72 22 84 40 80 60C77 78 62 84 46 84C30 84 23 76 20 66Z" fill="#b9b3d6"/>
      <path d="M21.5 70C25 78 32 84 46 84C62 84 75 78 79.2 64C74 74 62 79 47 79C34 79 26 76 21.5 70Z" fill="#8f88b5"/>
      <circle cx="66" cy="36" r="1.8" fill="#9d96c4"/><circle cx="28" cy="58" r="1.5" fill="#9d96c4"/><circle cx="70" cy="66" r="1.4" fill="#9d96c4"/>
      <ellipse cx="34" cy="36" rx="7" ry="3.6" fill="#ece9fb" opacity=".8" transform="rotate(-30 34 36)"/>
      ${smoothFace({ y: 56, gap: 12, rx: 3.2, ry: 3.8, cheekGap: 22, cheek: "#f59ab8", extra: `
        <g fill="#fff" fill-opacity=".22" stroke="#2b2840" stroke-width="2.6"><circle cx="-12" cy="0" r="8.5"/><circle cx="12" cy="0" r="8.5"/></g>
        <path d="M-3.5 -1Q0 -3.5 3.5 -1" stroke="#2b2840" stroke-width="2.6" fill="none"/>
        <g class="glare" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M-15 -3L-11 -7"/><path d="M9 -3L13 -7"/></g>` })}
      </g>${badge}` },
  { id: "boo", label: "Boo", style: "smooth", body: (id) => `<defs><clipPath id="b${id}"><path d="M20 80V48C20 30 32 18 48 18C64 18 76 30 76 48V80Q71 86 66 80Q61 74 56 80Q51 86 46 80Q41 74 36 80Q31 86 26 80Q23 77 20 80Z"/></clipPath></defs>${shadow(91, 20)}<g class="body">
      <g class="arm arm-l"><ellipse cx="19" cy="57" rx="5" ry="8" fill="#ddd6f6" transform="rotate(25 19 57)"/></g>
      <g class="arm arm-r"><ellipse cx="77" cy="57" rx="5" ry="8" fill="#ddd6f6" transform="rotate(-25 77 57)"/></g>
      <g clip-path="url(#b${id})"><path d="M20 80V48C20 30 32 18 48 18C64 18 76 30 76 48V80Q71 86 66 80Q61 74 56 80Q51 86 46 80Q41 74 36 80Q31 86 26 80Q23 77 20 80Z" fill="#f3f0ff"/><rect x="0" y="71" width="96" height="30" fill="#d6cff3"/></g>
      <ellipse cx="33" cy="32" rx="6" ry="3.4" fill="#fff" opacity=".9" transform="rotate(-35 33 32)"/>
      ${smoothFace({ y: 47, gap: 10, ink: "#2b2840", cheek: "#ffa3c4", cheekGap: 18 })}</g>${badge}` },
  { id: "mochi", label: "Mochi", style: "smooth", body: () => `${shadow(87, 28)}<g class="body">
      <g class="tail"><path d="M70 76Q91 73 86 52" stroke="#ffa45c" stroke-width="7.5" fill="none" stroke-linecap="round"/></g>
      <g class="ear-l"><path d="M22 46L26 18L43 33Z" fill="#ffa45c" stroke="#ffa45c" stroke-width="5" stroke-linejoin="round"/><path d="M27.5 37L28.8 25L37 32Z" fill="#ffb3c1"/></g>
      <g class="ear-r"><path d="M74 46L70 18L53 33Z" fill="#ffa45c" stroke="#ffa45c" stroke-width="5" stroke-linejoin="round"/><path d="M68.5 37L67.2 25L59 32Z" fill="#ffb3c1"/></g>
      <path d="M18 60C18 40 30 30 48 30C66 30 78 40 78 60C78 76 66 84 48 84C30 84 18 76 18 60Z" fill="#ffa45c"/>
      <path d="M48 78C30 78 21 71 19 63C22 76 34 84 48 84C62 84 74 76 77 63C75 71 66 78 48 78Z" fill="#e07b2e"/>
      <path d="M44 33L45 38M48 32V38M52 33L51 38" stroke="#e07b2e" stroke-width="2.5" stroke-linecap="round"/>
      ${smoothFace({ y: 56, gap: 11.5, ink: "#2a1406", cheekGap: 20, under: '<ellipse cx="0" cy="8" rx="11" ry="7" fill="#ffe3c7"/>', extra: '<path d="M-2.4 2.4H2.4L0 4.8Z" fill="#ff7a95" stroke="#ff7a95" stroke-width="1" stroke-linejoin="round"/>' })}</g>${badge}` },
  { id: "peep", label: "Peep", style: "smooth", body: () => `${shadow(90, 26)}<g class="body">
      <g class="wing-l"><ellipse cx="17" cy="60" rx="7" ry="11" fill="#f5b52a" transform="rotate(20 17 60)"/></g>
      <g class="wing-r"><ellipse cx="79" cy="60" rx="7" ry="11" fill="#f5b52a" transform="rotate(-20 79 60)"/></g>
      <path d="M45 19Q42 10 47 8M49 18Q51 10 56 10" stroke="#f0a81c" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M48 18C70 18 82 36 82 56C82 74 68 84 48 84C28 84 14 74 14 56C14 36 26 18 48 18Z" fill="#ffd23f"/>
      <path d="M48 76C30 76 20 68 18 58C24 72 36 80 48 80C62 80 74 72 78 58C76 68 66 76 48 76Z" fill="#f0a81c"/>
      <ellipse cx="32" cy="34" rx="7" ry="4" fill="#fff4c4" opacity=".8" transform="rotate(-30 32 34)"/>
      <path d="M41 84v4M37.5 88h7M55 84v4M51.5 88h7" stroke="#ff8a3d" stroke-width="2.5" stroke-linecap="round"/>
      ${smoothFace({ y: 54, gap: 11, ink: "#2b1d05", cheek: "#ff9d7a", mouth: false, extra: `
        <path class="m-idle" d="M-4.5 3L0 0L4.5 3L0 7Z" fill="#ff8a3d" stroke="#ff8a3d" stroke-width="1" stroke-linejoin="round"/>
        <path class="m-work" d="M-4 3.5L0 1.5L4 3.5L0 6Z" fill="#ff8a3d" stroke="#ff8a3d" stroke-width="1" stroke-linejoin="round"/>
        <g class="m-wait" fill="#ff8a3d" stroke="#ff8a3d" stroke-width="1" stroke-linejoin="round"><path d="M-4 2L0 -.5L4 2Z"/><path d="M-3 4H3L0 7Z"/></g>
        <g class="m-unread" fill="#ff8a3d" stroke="#ff8a3d" stroke-width="1" stroke-linejoin="round"><path d="M-5 2L0 -1L5 2Z"/><path d="M-4 5H4L0 9.5Z"/></g>` })}</g>${badge}` },
];

const GEOMETRIC: GalleryAvatar[] = [
  { id: "prism", label: "Prism", style: "geo", body: (id) => `<defs><clipPath id="c${id}"><circle cx="48" cy="46" r="17"/></clipPath></defs>${shadow(90, 22)}<g class="body">
      <path d="M48 14L77 31V65L48 82L19 65V31Z" fill="#9b6cf0" stroke="#9b6cf0" stroke-width="10" stroke-linejoin="round"/>
      <path d="M19 62L48 76L77 62V65L48 82L19 65Z" fill="#6b3fc0" stroke="#6b3fc0" stroke-width="10" stroke-linejoin="round"/>
      <path d="M27 29L48 17L57 22" stroke="#c9b3ff" stroke-width="4" stroke-linecap="round" fill="none"/>
      <circle cx="48" cy="46" r="17" fill="#fff"/>
      <g clip-path="url(#c${id})"><g class="track" data-x="0" data-y="0" data-kx="7" data-ky="7"><g class="irisg">
        <circle cx="48" cy="46" r="9.5" fill="#3fb8a0"/><circle cx="48" cy="46" r="4.6" fill="#14112a"/><rect x="43" y="41" width="3.6" height="3.6" fill="#fff"/></g></g>
        <rect class="lid" x="30" y="28" width="36" height="36" fill="#8a5ae6"/></g>
      <circle cx="48" cy="46" r="17" fill="none" stroke="#4a2f8f" stroke-width="2.5"/>
      <g transform="translate(48 65)">${mouths(1, "#3a2270", 5)}</g></g>
      <g class="orbiter"><circle cx="48" cy="5" r="4.5" fill="#ffd54a"/></g>${badge}` },
  { id: "tri", label: "Tri", style: "geo", body: () => `${shadow(88, 30)}<g class="body">
      <path d="M48 16L82 76H14Z" fill="#ff9b42" stroke="#ff9b42" stroke-width="10" stroke-linejoin="round"/>
      <path d="M48 16L82 76H48Z" fill="#f2832a" stroke="#f2832a" stroke-width="10" stroke-linejoin="round"/>
      <path d="M14 76H82" stroke="#d96a17" stroke-width="10" stroke-linecap="round"/>
      ${geoFace({ y: 56, gap: 8.5, r: 3.8 })}</g>${badge}` },
  { id: "orbit", label: "Orbit", style: "geo", body: (id) => `<defs><clipPath id="o${id}"><circle cx="48" cy="50" r="26"/></clipPath></defs>${shadow(90, 22)}<g class="body">
      <g class="ring"><g transform="rotate(-15 48 52)"><ellipse cx="48" cy="52" rx="41" ry="10" fill="none" stroke="#e0b02c" stroke-width="5"/></g></g>
      <circle cx="48" cy="50" r="26" fill="#2c8f7c"/>
      <g clip-path="url(#o${id})"><circle cx="44" cy="46" r="25" fill="#3fc1a7"/></g>
      ${geoFace({ y: 42, gap: 8, r: 3.4, my: 5, ky: 2.5, w: 3.5 })}
      <g class="ring"><g transform="rotate(-15 48 52)"><path d="M7 52A41 10 0 0 0 89 52" fill="none" stroke="#ffd54a" stroke-width="5"/>
        <circle class="moon" r="4" fill="#fff"><animateMotion dur="1.6s" repeatCount="indefinite" path="M7 52A41 10 0 1 0 89 52A41 10 0 1 0 7 52"/></circle></g></g>
      </g>${badge}` },
  { id: "gem", label: "Gem", style: "geo", body: (id) => `<defs><clipPath id="g${id}"><path d="M30 18H66L82 38L48 84L14 38Z"/></clipPath></defs>${shadow(90, 20)}<g class="body">
      <path d="M30 18H66L82 38L48 84L14 38Z" fill="#ff6fae" stroke="#ff6fae" stroke-width="6" stroke-linejoin="round"/>
      <path d="M30 18H66L82 38H14Z" fill="#ff9cc9" stroke="#ff9cc9" stroke-width="6" stroke-linejoin="round"/>
      <path d="M48 38H82L48 84Z" fill="#e8509a" stroke="#e8509a" stroke-width="6" stroke-linejoin="round"/>
      <path d="M38 18L48 38L58 18" fill="#ffc4de"/>
      <g clip-path="url(#g${id})"><rect class="shine" x="-24" y="0" width="12" height="96" fill="#fff" opacity=".5" transform="skewX(-20)"/></g>
      ${geoFace({ y: 50, gap: 8, r: 3.4, my: 6, kx: 4, ky: 2.5, w: 3.5 })}</g>
      <path class="spark" d="M84 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#ffd54a"/><path class="spark" d="M12 56l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#ffd54a"/>${badge}` },
  { id: "luna", label: "Luna", style: "geo", body: (id) => `<defs><mask id="l${id}"><rect width="96" height="96" fill="#fff"/><circle cx="66" cy="37" r="24" fill="#000"/></mask></defs>${shadow(88, 24)}<g class="body">
      <g mask="url(#l${id})"><circle cx="48" cy="50" r="31" fill="#e8a817"/><circle cx="45" cy="47" r="29" fill="#ffd54a"/></g>
      <circle cx="27" cy="38" r="2.8" fill="#f0bd2a"/><circle cx="46" cy="72" r="2.2" fill="#f0bd2a"/><circle cx="22" cy="58" r="1.6" fill="#f0bd2a"/>
      ${geoFace({ x: 33, y: 57, gap: 6.5, r: 3, my: 5.5, kx: 3, ky: 2, w: 3 })}</g>
      <path class="tw" d="M74 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff6c9"/>${badge}` },
  { id: "pill", label: "Pill", style: "geo", body: (id) => `<defs><clipPath id="c${id}"><rect x="12" y="32" width="72" height="40" rx="20"/></clipPath></defs>${shadow(84, 30)}<g class="body">
      <g class="tilt"><g transform="rotate(-18 48 52)"><g clip-path="url(#c${id})">
        <rect x="12" y="32" width="36" height="40" fill="#4f8ff7"/><rect x="48" y="32" width="36" height="40" fill="#eef2fb"/>
        <rect x="12" y="64" width="36" height="8" fill="#2f6fd6"/><rect x="48" y="64" width="36" height="8" fill="#c8d3ec"/>
        <rect x="24" y="37" width="18" height="4" rx="2" fill="#fff" opacity=".45"/></g></g></g>
      ${geoFace({ y: 52, gap: 9.5, r: 3.6, my: 6.5 })}</g>${badge}` },
  { id: "nova", label: "Nova", style: "geo", body: (id) => `<defs><clipPath id="n${id}"><rect x="0" y="63" width="96" height="40"/></clipPath></defs>${shadow(90, 24)}<g class="body">
      <g class="shape"><path d="${NOVA_OUTLINE}" fill="#ff6b5e" stroke="#ff6b5e" stroke-width="7" stroke-linejoin="round"/>
        <g clip-path="url(#n${id})"><path d="${NOVA_OUTLINE}" fill="#e2483d" stroke="#e2483d" stroke-width="7" stroke-linejoin="round"/></g>
        <circle cx="48" cy="24" r="3" fill="#ffb4ab"/></g>
      ${geoFace({ y: 52, gap: 7.5, r: 3.4, my: 6, kx: 4, ky: 3, w: 3.5 })}</g>
      <path class="spark" d="M84 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#ffd54a"/><path class="spark" d="M12 70l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#ffd54a"/>${badge}` },
  { id: "cubo", label: "Cubo", style: "geo", body: () => `${shadow(88, 28)}<g class="body">
      <path d="M18 36L62 42V82L18 76Z" fill="#5b84f0" stroke="#5b84f0" stroke-width="4" stroke-linejoin="round"/>
      <path d="M62 42L80 30V70L62 82Z" fill="#3d63d1" stroke="#3d63d1" stroke-width="4" stroke-linejoin="round"/>
      <g class="lid"><path d="M18 36L36 24L80 30L62 42Z" fill="#9db9ff" stroke="#9db9ff" stroke-width="4" stroke-linejoin="round"/></g>
      <g transform="translate(40 59) matrix(.991 .135 0 1 0 0)">${geoFace({ x: 0, y: 0, gap: 8.5, r: 3.6, my: 6.5, kx: 4, ky: 3, w: 3.8 })}</g>
      </g>${badge}` },
];

export const SMOOTH_AVATARS: readonly GalleryAvatar[] = SMOOTH;
export const GEOMETRIC_AVATARS: readonly GalleryAvatar[] = GEOMETRIC;
export const GALLERY = Object.fromEntries([...SMOOTH, ...GEOMETRIC].map((def) => [def.id, def])) as Record<GalleryId, GalleryAvatar>;
