// Frontend- and server-safe gallery ids. The art lives in gallery.ts.

export const SMOOTH_IDS = ["bean", "sprout", "puff", "inky", "pebble", "boo", "mochi", "peep"] as const;
export const GEOMETRIC_IDS = ["prism", "tri", "orbit", "gem", "luna", "pill", "nova", "cubo"] as const;
export const GALLERY_IDS = [...SMOOTH_IDS, ...GEOMETRIC_IDS] as const;
export type GalleryId = (typeof GALLERY_IDS)[number];

/** A gallery pick is stored in `Bot.avatar` as `gallery:<id>`. */
export const GALLERY_PREFIX = "gallery:";
export const galleryAvatar = (id: GalleryId) => `${GALLERY_PREFIX}${id}`;

/** The gallery id a stored avatar names, or null for uploads, unknown ids, and no avatar. */
export function galleryId(avatar: string | null | undefined): GalleryId | null {
  if (!avatar?.startsWith(GALLERY_PREFIX)) return null;
  const id = avatar.slice(GALLERY_PREFIX.length);
  return (GALLERY_IDS as readonly string[]).includes(id) ? id as GalleryId : null;
}
