// Styles for gallery avatars, ported from the prototype. Every rule sits under
// `.bb-av` and every keyframe name starts with `bbav-` so host styles and these
// do not collide. Character and style classes carry an `av-` prefix.

export const AVATAR_CSS = `
.bb-av { overflow:visible; display:block; flex:none; }
.bb-av .eye { transform-box:fill-box; transform-origin:center; animation:bbav-blink var(--blink, 5s) var(--bd, 0s) infinite; }
@keyframes bbav-blink { 0%, 95%, 100% { transform:scaleY(1); } 97% { transform:scaleY(.1); } }
.bb-av .m-work, .bb-av .m-unread, .bb-av .m-wait, .bb-av .badge, .bb-av .ask { display:none; }
.bb-av.st-working .m-idle, .bb-av.st-unread .m-idle { display:none; }
.bb-av.st-working .m-work, .bb-av.st-unread .m-unread { display:inline; }
.bb-av.st-working .eye { animation:none; transform:scaleY(.55); }
.bb-av.st-working .gaze { transform:translate(-1.5px, 2px); }
.bb-av.st-unread .eye { animation:none; transform:scale(1.18); }

/* smooth: squash and stretch around the feet */
.bb-av.av-smooth .body { transform-origin:48px 84px; }
.bb-av.av-smooth.st-idle .body { animation:bbav-breathe 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-smooth.st-working .body { animation:bbav-busy .5s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-smooth.st-unread .body { animation:bbav-attn 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-breathe { 50% { transform:scale(1.03, .96); } }
@keyframes bbav-busy { 50% { transform:translateY(-3px) scale(.98, 1.02); } }
@keyframes bbav-attn {
  0%, 60%, 100% { transform:translateY(0) scale(1, 1); }
  66% { transform:translateY(0) scale(1.12, .86); }
  74% { transform:translateY(-16px) scale(.93, 1.08); }
  82% { transform:translateY(0) scale(1.1, .9); }
  88% { transform:translateY(0) scale(.97, 1.03); }
  94% { transform:translateY(0) scale(1, 1); } }

/* geometric: rigid moves around the center, no squash */
.bb-av.av-geo .body { transform-origin:48px 50px; }
.bb-av.av-geo.st-idle .body { animation:bbav-float 3.6s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-geo.st-working .body { animation:bbav-rock .8s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-geo.st-unread .body { animation:bbav-spinhop 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-float { 50% { transform:translateY(-3px); } }
@keyframes bbav-rock { 0%, 100% { transform:rotate(-7deg); } 50% { transform:rotate(7deg); } }
@keyframes bbav-spinhop {
  0%, 60% { transform:translateY(0) rotate(0deg) scale(1, 1); }
  70% { transform:translateY(-14px) rotate(180deg) scale(1, 1); }
  80% { transform:translateY(0) rotate(360deg) scale(1, 1); }
  86% { transform:translateY(0) rotate(360deg) scale(1.08, .92); }
  92%, 100% { transform:translateY(0) rotate(360deg) scale(1, 1); } }
@keyframes bbav-hop {
  0%, 60%, 100% { transform:translateY(0); } 70% { transform:translateY(-13px); } 80% { transform:translateY(0); }
  86% { transform:translateY(-3px); } 92% { transform:translateY(0); } }

/* per-character motion */
.bb-av.av-sprout .leaf { transform-origin:48px 33px; animation:bbav-sway 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-sprout.st-working .leaf { animation:bbav-prop .28s linear infinite; }
.bb-av.av-sprout.st-unread .leaf { animation:bbav-perk 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-sway { 0%, 100% { transform:rotate(-7deg); } 50% { transform:rotate(7deg); } }
@keyframes bbav-prop { 0%, 100% { transform:scaleX(1); } 50% { transform:scaleX(-1); } }
@keyframes bbav-perk { 0%, 60%, 100% { transform:rotate(0); } 70% { transform:rotate(-24deg); } 78% { transform:rotate(22deg); } 86% { transform:rotate(-8deg); } }

.bb-av.av-puff .body { transform-origin:48px 56px; }
.bb-av.av-puff.st-unread .body { animation:bbav-puffup 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-puff .rain { display:none; }
.bb-av.av-puff.st-working .rain { display:inline; }
.bb-av.av-puff .drop { animation:bbav-fall .7s linear infinite; }
.bb-av.av-puff .drop:nth-child(2) { animation-delay:-.23s; }
.bb-av.av-puff .drop:nth-child(3) { animation-delay:-.47s; }
@keyframes bbav-fall { from { transform:translateY(0); opacity:1; } to { transform:translateY(13px); opacity:0; } }
@keyframes bbav-puffup { 0%, 60%, 100% { transform:scale(1); } 67% { transform:scale(1.15); } 75% { transform:scale(.97); } 83% { transform:scale(1.1); } 91% { transform:scale(1); } }

.bb-av.av-inky.st-unread .body { animation:bbav-breathe 3s ease-in-out infinite; }
.bb-av.av-inky .t { animation:bbav-wig 2s ease-in-out infinite; }
.bb-av.av-inky .t:nth-child(2) { animation-delay:-.5s; }
.bb-av.av-inky .t:nth-child(3) { animation-delay:-1s; }
.bb-av.av-inky .t:nth-child(4) { animation-delay:-1.5s; }
.bb-av.av-inky.st-working .t { animation:bbav-wigfast .32s ease-in-out infinite; }
.bb-av.av-inky.st-unread .t4 { animation:bbav-wave 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-wig { 0%, 100% { transform:rotate(-5deg); } 50% { transform:rotate(5deg); } }
@keyframes bbav-wigfast { 0%, 100% { transform:rotate(-13deg); } 50% { transform:rotate(13deg); } }
@keyframes bbav-wave { 0%, 56%, 100% { transform:rotate(0); } 64% { transform:rotate(-120deg); } 70% { transform:rotate(-95deg); } 76% { transform:rotate(-125deg); } 82% { transform:rotate(-95deg); } 92% { transform:rotate(0); } }

.bb-av.av-pebble .glare { opacity:0; }
.bb-av.av-pebble.st-working .glare { animation:bbav-glare 1.6s ease-in-out infinite; }
.bb-av.av-pebble.st-working .gaze { transform:translate(0, 2.5px); }
@keyframes bbav-glare { 0% { opacity:0; transform:translateX(-5px); } 30% { opacity:.9; } 60%, 100% { opacity:0; transform:translateX(5px); } }

.bb-av.av-prism .lid { transform-box:fill-box; transform-origin:top; transform:scaleY(0); animation:bbav-lid var(--blink, 5s) var(--bd, 0s) infinite; }
.bb-av.av-prism.st-working .lid { animation:none; transform:scaleY(.45); }
.bb-av.av-prism.st-unread .lid { animation:none; transform:scaleY(0); }
.bb-av.av-prism .irisg { transform-origin:48px 46px; transition:transform .2s; }
.bb-av.av-prism.st-unread .irisg { transform:scale(1.2); }
.bb-av.av-prism .orbiter { display:none; transform-origin:48px 48px; }
.bb-av.av-prism.st-working .orbiter { display:inline; animation:bbav-spin 1.3s linear infinite; }
@keyframes bbav-lid { 0%, 95%, 100% { transform:scaleY(0); } 97% { transform:scaleY(1); } }
@keyframes bbav-spin { to { transform:rotate(360deg); } }

.bb-av.av-orbit .ring { transform-origin:48px 52px; }
.bb-av.av-orbit.st-working .body { animation:bbav-float 1.1s ease-in-out infinite; }
.bb-av.av-orbit.st-unread .body { animation:bbav-hop 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-orbit.st-unread .ring { animation:bbav-wobble 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-orbit .moon { display:none; }
.bb-av.av-orbit.st-working .moon { display:inline; }
@keyframes bbav-wobble { 0%, 60%, 100% { transform:rotate(0); } 70% { transform:rotate(20deg); } 80% { transform:rotate(-13deg); } 90% { transform:rotate(5deg); } }

.bb-av.av-gem .shine { animation:bbav-shine 6s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-gem.st-working .shine { animation:bbav-shine 1s ease-in-out infinite; }
.bb-av.av-gem.st-unread .body { animation:bbav-flip 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-gem .spark { display:none; transform-box:fill-box; transform-origin:center; }
.bb-av.av-gem.st-unread .spark { display:inline; animation:bbav-twinkle 1.4s ease-in-out infinite; }
.bb-av.av-gem.st-unread .spark + .spark { animation-delay:-.7s; }
@keyframes bbav-shine { 0%, 80% { transform:translateX(0); } 100% { transform:translateX(120px); } }
@keyframes bbav-flip {
  0%, 58%, 100% { transform:translateY(0) scaleX(1); } 66% { transform:translateY(-12px) scaleX(0); } 72% { transform:translateY(-14px) scaleX(-1); }
  78% { transform:translateY(-8px) scaleX(0); } 86% { transform:translateY(0) scaleX(1); } }
@keyframes bbav-twinkle { 0%, 100% { transform:scale(0); } 50% { transform:scale(1); } }

.bb-av.av-tri.st-working .body { transform-origin:48px 78px; }

.bb-av.av-luna .tw { opacity:0; transform-box:fill-box; transform-origin:center; }
.bb-av.av-luna.st-working .tw { opacity:1; animation:bbav-twinkle 1.2s ease-in-out infinite; }
.bb-av.av-luna.st-working .body { transform-origin:48px 82px; animation:bbav-rock 1.6s ease-in-out infinite; }
.bb-av.av-pill .tilt { transform-origin:48px 52px; }
.bb-av.av-pill.st-working .body { animation:none; }
.bb-av.av-pill.st-working .tilt { animation:bbav-twist .9s ease-in-out infinite; }
@keyframes bbav-twist { 0%, 100% { transform:rotate(-14deg) scale(1, 1); } 50% { transform:rotate(14deg) scale(1.03, .97); } }
.bb-av.av-nova .shape { transform-origin:48px 52px; }
.bb-av.av-nova.st-working .body { animation:bbav-float 1.6s ease-in-out infinite; }
.bb-av.av-nova.st-working .shape { animation:bbav-spin 4s linear infinite; }
.bb-av.av-nova .spark { display:none; transform-box:fill-box; transform-origin:center; }
.bb-av.av-nova.st-unread .spark { display:inline; animation:bbav-twinkle 1.4s ease-in-out infinite; }
.bb-av.av-nova.st-unread .spark + .spark { animation-delay:-.7s; }

.bb-av.av-boo.st-idle .body { animation:bbav-float 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-boo.st-working .body { animation:bbav-float 1.3s ease-in-out infinite; }
.bb-av.av-boo .arm-l { transform-origin:23px 50px; }
.bb-av.av-boo .arm-r { transform-origin:73px 50px; }
.bb-av.av-boo.st-working .arm-l { animation:bbav-tapL .3s ease-in-out infinite; }
.bb-av.av-boo.st-working .arm-r { animation:bbav-tapR .3s ease-in-out -.15s infinite; }
.bb-av.av-boo.st-unread .arm-l { animation:bbav-upL 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-boo.st-unread .arm-r { animation:bbav-upR 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-tapL { 50% { transform:rotate(-28deg); } }
@keyframes bbav-tapR { 50% { transform:rotate(28deg); } }
@keyframes bbav-upL { 0%, 58%, 100% { transform:rotate(0); } 68%, 86% { transform:rotate(115deg); } }
@keyframes bbav-upR { 0%, 58%, 100% { transform:rotate(0); } 68%, 86% { transform:rotate(-115deg); } }

.bb-av.av-mochi .tail { transform-origin:72px 75px; animation:bbav-tail 2.4s ease-in-out infinite; }
.bb-av.av-mochi.st-working .tail { animation-duration:.45s; }
.bb-av.av-mochi .ear-l { transform-origin:32px 40px; animation:bbav-twitch 4.5s ease-in-out var(--bd, 0s) infinite; }
.bb-av.av-mochi .ear-r { transform-origin:64px 40px; }
.bb-av.av-mochi.st-unread .ear-l, .bb-av.av-mochi.st-unread .ear-r { animation:bbav-perkear 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-tail { 0%, 100% { transform:rotate(-8deg); } 50% { transform:rotate(14deg); } }
@keyframes bbav-twitch { 0%, 88%, 100% { transform:rotate(0); } 92% { transform:rotate(-14deg); } 96% { transform:rotate(4deg); } }
@keyframes bbav-perkear { 0%, 60%, 100% { transform:scaleY(1); } 68%, 84% { transform:scaleY(1.22); } }

.bb-av.av-peep .wing-l { transform-origin:21px 51px; }
.bb-av.av-peep .wing-r { transform-origin:75px 51px; }
.bb-av.av-peep.st-working .wing-l { animation:bbav-flapL .22s ease-in-out infinite; }
.bb-av.av-peep.st-working .wing-r { animation:bbav-flapR .22s ease-in-out infinite; }
.bb-av.av-peep.st-unread .wing-l { animation:bbav-upL 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-peep.st-unread .wing-r { animation:bbav-upR 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-flapL { 50% { transform:rotate(32deg); } }
@keyframes bbav-flapR { 50% { transform:rotate(-32deg); } }

.bb-av.av-cubo .lid { transform-origin:40px 39px; }
.bb-av.av-cubo.st-working .body { animation:none; }
.bb-av.av-cubo.st-working .lid { animation:bbav-rattle .36s steps(2) infinite; }
.bb-av.av-cubo.st-unread .body { animation:bbav-hop 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-cubo.st-unread .lid { animation:bbav-lidpop 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-rattle { 0% { transform:translateY(0) rotate(0); } 50% { transform:translateY(-3px) rotate(-3deg); } }
@keyframes bbav-lidpop { 0%, 60%, 100% { transform:translateY(0) rotate(0); } 70% { transform:translateY(-12px) rotate(-14deg); } 82% { transform:translateY(0) rotate(0); } }

/* waiting for an approval or an answer */
.bb-av.st-waiting .m-idle { display:none; }
.bb-av.st-waiting .m-wait { display:inline; }
.bb-av.st-waiting .ask { display:inline; transform-box:fill-box; transform-origin:0% 100%; animation:bbav-askbob 1.6s ease-in-out infinite; }
.bb-av.st-waiting .gaze { transform:translate(0, -1.5px); }
.bb-av.av-smooth.st-waiting .body { animation:bbav-tilt 4s ease-in-out infinite; }
.bb-av.av-geo.st-waiting .body { animation:bbav-tilt 4s ease-in-out infinite; }
.bb-av.av-boo.st-waiting .arm-r { animation:bbav-handup 1.1s ease-in-out infinite; }
.bb-av.av-prism.st-waiting .lid { animation:none; transform:scaleY(0); }
.bb-av.av-prism.st-waiting .irisg { transform:translateY(-3px); }
@keyframes bbav-askbob { 0%, 100% { transform:translateY(0) rotate(-8deg); } 50% { transform:translateY(-3px) rotate(8deg); } }
@keyframes bbav-tilt { 0%, 40% { transform:rotate(-9deg); } 50%, 90% { transform:rotate(9deg); } 100% { transform:rotate(-9deg); } }
@keyframes bbav-handup { 0%, 100% { transform:rotate(-112deg); } 50% { transform:rotate(-82deg); } }

.bb-av.av-sprout.st-waiting .leaf { animation:bbav-leafq 2s ease-in-out infinite; }
.bb-av.av-inky.st-waiting .t4 { animation:bbav-holdup 1.4s ease-in-out infinite; }
.bb-av.av-mochi.st-waiting .tail { animation:bbav-tailq 1.8s ease-in-out infinite; }
.bb-av.av-mochi.st-waiting .ear-r { transform:rotate(16deg); }
.bb-av.av-peep.st-waiting .wing-r { animation:bbav-handup 1.1s ease-in-out infinite; }
.bb-av.av-cubo.st-waiting .lid { transform:translateY(-4px) rotate(-8deg); }
.bb-av.av-luna.st-waiting .tw { opacity:1; }
@keyframes bbav-leafq { 0%, 100% { transform:rotate(-24deg); } 50% { transform:rotate(-12deg); } }
@keyframes bbav-holdup { 0%, 100% { transform:rotate(-112deg); } 50% { transform:rotate(-95deg); } }
@keyframes bbav-tailq { 0%, 100% { transform:rotate(-22deg); } 50% { transform:rotate(-6deg); } }

/* Reduced motion: nothing moves. Unread shows a badge; waiting keeps its still question bubble. */
@media (prefers-reduced-motion: reduce) {
  .bb-av, .bb-av * { animation:none !important; transition:none !important; }
  .bb-av.st-unread .badge { display:inline; }
  .bb-av .moon { display:none; }
}
`;

const STYLE_ID = "bb-animated-avatars";

let injected = false;

/**
 * Adds the avatar styles to the document, once per loaded bundle. Bots and the
 * Launcher each bundle this module; a reloaded plugin's copy replaces the text
 * left by its earlier version.
 */
export function injectAvatarStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.getElementById(STYLE_ID) ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: STYLE_ID }));
  if (style.textContent !== AVATAR_CSS) style.textContent = AVATAR_CSS;
}
