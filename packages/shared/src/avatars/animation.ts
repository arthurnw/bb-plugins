// Recognizes animated uploads from their bytes. Frontend- and server-safe.

export type AnimationType = "image/gif" | "image/webp" | "image/png";

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const uint32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The type of an animated GIF, WebP, or PNG (APNG); null for still images and other formats. */
export function animatedImageType(bytes: Uint8Array): AnimationType | null {
  const head = ascii(bytes, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return gifFrames(bytes) > 1 ? "image/gif" : null;
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    // Only the extended format can animate; flag 0x02 is "animation".
    return ascii(bytes, 12, 4) === "VP8X" && (bytes[20]! & 0x02) !== 0 ? "image/webp" : null;
  }
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return apngFrames(bytes) > 1 ? "image/png" : null;
  return null;
}

/** Counts image descriptors, stopping at two. */
function gifFrames(bytes: Uint8Array): number {
  const colorTable = (packed: number) => (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  const skipSubBlocks = (at: number) => {
    while (at < bytes.length) {
      const size = bytes[at++]!;
      if (size === 0) break;
      at += size;
    }
    return at;
  };
  let at = 13 + colorTable(bytes[10] ?? 0);
  let frames = 0;
  while (at < bytes.length && frames < 2) {
    const block = bytes[at];
    if (block === 0x21) at = skipSubBlocks(at + 2);
    else if (block === 0x2c) {
      frames++;
      at = skipSubBlocks(at + 10 + colorTable(bytes[at + 9] ?? 0) + 1);
    } else break;
  }
  return frames;
}

/** The frame count from `acTL`, which must come before the first `IDAT`; 1 for a plain PNG. */
function apngFrames(bytes: Uint8Array): number {
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = uint32(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    if (type === "acTL") return uint32(bytes, at + 8);
    if (type === "IDAT") break;
    at += 12 + length;
  }
  return 1;
}

/** The bytes of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
