export const SLUG_MAX_LENGTH = 60;

/**
 * Turns a shop name into a lowercase, URL-safe slug: strips diacritics and apostrophes, replaces
 * every run of other characters with `-`, and caps the length. May return `''` (e.g. "!!!").
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}
