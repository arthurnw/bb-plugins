// Styles for gallery avatars, ported from the prototype. Every rule sits under
// `.bb-av` and every keyframe name starts with `bbav-` so host styles and these
// do not collide. Character and style classes carry an `av-` prefix.

export const AVATAR_CSS = `
.bb-av { overflow:visible; display:block; flex:none; }
.bb-av .eye { transform-box:fill-box; transform-origin:center; animation:bbav-blink var(--blink, 5s) var(--bd, 0s) infinite; }
@keyframes bbav-blink { 0%, 95%, 100% { transform:scaleY(1); } 97% { transform:scaleY(.1); } }
.bb-av .m-work, .bb-av .m-unread, .bb-av .m-wait, .bb-av .badge, .bb-av .ask { display:none; }

.bb-av.av-smooth .body { transform-origin:48px 84px; }
.bb-av.av-smooth.st-idle .body { animation:bbav-breathe 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-breathe { 50% { transform:scale(1.03, .96); } }

.bb-av.av-geo .body { transform-origin:48px 50px; }
.bb-av.av-geo.st-idle .body { animation:bbav-float 3.6s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-float { 50% { transform:translateY(-3px); } }

.bb-av.av-sprout .leaf { transform-origin:48px 33px; animation:bbav-sway 3s ease-in-out var(--ph, 0s) infinite; }
@keyframes bbav-sway { 0%, 100% { transform:rotate(-7deg); } 50% { transform:rotate(7deg); } }

.bb-av.av-puff .body { transform-origin:48px 56px; }
.bb-av.av-puff .rain { display:none; }

.bb-av.av-inky .t { animation:bbav-wig 2s ease-in-out infinite; }
.bb-av.av-inky .t:nth-child(2) { animation-delay:-.5s; }
.bb-av.av-inky .t:nth-child(3) { animation-delay:-1s; }
.bb-av.av-inky .t:nth-child(4) { animation-delay:-1.5s; }
@keyframes bbav-wig { 0%, 100% { transform:rotate(-5deg); } 50% { transform:rotate(5deg); } }

.bb-av.av-pebble .glare { opacity:0; }

.bb-av.av-prism .lid { transform-box:fill-box; transform-origin:top; transform:scaleY(0); animation:bbav-lid var(--blink, 5s) var(--bd, 0s) infinite; }
.bb-av.av-prism .irisg { transform-origin:48px 46px; transition:transform .2s; }
.bb-av.av-prism .orbiter { display:none; transform-origin:48px 48px; }
@keyframes bbav-lid { 0%, 95%, 100% { transform:scaleY(0); } 97% { transform:scaleY(1); } }

.bb-av.av-orbit .ring { transform-origin:48px 52px; }
.bb-av.av-orbit .moon { display:none; }

.bb-av.av-gem .shine { animation:bbav-shine 6s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-gem .spark { display:none; transform-box:fill-box; transform-origin:center; }
@keyframes bbav-shine { 0%, 80% { transform:translateX(0); } 100% { transform:translateX(120px); } }

.bb-av.av-luna .tw { opacity:0; transform-box:fill-box; transform-origin:center; }
.bb-av.av-pill .tilt { transform-origin:48px 52px; }
.bb-av.av-nova .shape { transform-origin:48px 52px; }
.bb-av.av-nova .spark { display:none; transform-box:fill-box; transform-origin:center; }

.bb-av.av-boo.st-idle .body { animation:bbav-float 3s ease-in-out var(--ph, 0s) infinite; }
.bb-av.av-boo .arm-l { transform-origin:23px 50px; }
.bb-av.av-boo .arm-r { transform-origin:73px 50px; }

.bb-av.av-mochi .tail { transform-origin:72px 75px; animation:bbav-tail 2.4s ease-in-out infinite; }
.bb-av.av-mochi .ear-l { transform-origin:32px 40px; animation:bbav-twitch 4.5s ease-in-out var(--bd, 0s) infinite; }
.bb-av.av-mochi .ear-r { transform-origin:64px 40px; }
@keyframes bbav-tail { 0%, 100% { transform:rotate(-8deg); } 50% { transform:rotate(14deg); } }
@keyframes bbav-twitch { 0%, 88%, 100% { transform:rotate(0); } 92% { transform:rotate(-14deg); } 96% { transform:rotate(4deg); } }

.bb-av.av-peep .wing-l { transform-origin:21px 51px; }
.bb-av.av-peep .wing-r { transform-origin:75px 51px; }

.bb-av.av-cubo .lid { transform-origin:40px 39px; }
`;

const STYLE_ID = "bb-animated-avatars";

/**
 * Adds the avatar styles to the document once. Bots and the Launcher each
 * bundle this module; whichever renders an avatar first supplies the styles.
 */
export function injectAvatarStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = AVATAR_CSS;
  document.head.appendChild(style);
}
