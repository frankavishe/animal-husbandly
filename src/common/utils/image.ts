export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type ImageExt = 'jpg' | 'png' | 'webp';

export interface DetectedImage {
  mime: ImageMime;
  ext: ImageExt;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * Detects JPEG, PNG or WebP from the file's magic bytes (never from the name or the client's
 * MIME type). Returns `null` for anything else.
 */
export function detectImageType(buf: Buffer): DetectedImage | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith(buf, PNG_SIGNATURE)) return { mime: 'image/png', ext: 'png' };
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}
