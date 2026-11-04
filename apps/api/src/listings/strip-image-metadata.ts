/**
 * Public deal-page pictures: recognise the format by its bytes and drop metadata (camera,
 * location, comments) before anything is stored or shown. Byte-level, no image library:
 * pixel data is copied untouched.
 */
export type ListingImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export class ImageRejectedError extends Error {
  constructor(readonly reason: 'NOT_AN_IMAGE' | 'MALFORMED') {
    super(`Image rejected: ${reason}`);
    this.name = 'ImageRejectedError';
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (bytes: Uint8Array, magic: readonly number[], at = 0) => magic.every((byte, index) => bytes[at + index] === byte);
const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));

/** The image type from its first bytes; SVG and everything else is not an image here. */
export function sniffImage(bytes: Uint8Array): ListingImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/** JPEG: drop APP1 (EXIF, XMP), APP13 (IPTC) and comment segments; copy the rest, then the scan data, as is. */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) throw new ImageRejectedError('MALFORMED');
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Start of scan: everything from here (entropy-coded data and the end marker) is image data.
    if (marker === 0xda) {
      out.push(...bytes.subarray(at));
      return Uint8Array.from(out);
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      return Uint8Array.from(out);
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    if (length < 2 || at + 2 + length > bytes.length) throw new ImageRejectedError('MALFORMED');
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(...bytes.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  throw new ImageRejectedError('MALFORMED');
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

/** PNG: drop EXIF and text chunks; every other chunk (with its CRC) is copied as is. */
function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = ((bytes[at] ?? 0) * 2 ** 24) + (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
    const type = ascii(bytes, at + 4, 4);
    const end = at + 12 + length;
    if (end > bytes.length) throw new ImageRejectedError('MALFORMED');
    if (!PNG_DROP.has(type)) parts.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') return concat(parts);
  }
  throw new ImageRejectedError('MALFORMED');
}

/** WebP: drop EXIF and XMP chunks, clear their flags in VP8X, and fix the RIFF size. */
function stripWebp(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const type = ascii(bytes, at, 4);
    const size = (bytes[at + 4] ?? 0) | ((bytes[at + 5] ?? 0) << 8) | ((bytes[at + 6] ?? 0) << 16) | ((bytes[at + 7] ?? 0) * 2 ** 24);
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > bytes.length) throw new ImageRejectedError('MALFORMED');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Uint8Array.from(bytes.subarray(at, Math.min(end, bytes.length)));
      // VP8X flags: bit 3 EXIF, bit 2 XMP.
      if (type === 'VP8X' && chunk.length > 8) chunk[8] = (chunk[8] ?? 0) & ~0b1100;
      parts.push(chunk);
    }
    at = end;
  }
  const body = concat(parts);
  const header = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const riffSize = body.length + 4;
  header[4] = riffSize & 0xff;
  header[5] = (riffSize >> 8) & 0xff;
  header[6] = (riffSize >> 16) & 0xff;
  header[7] = (riffSize >>> 24) & 0xff;
  return concat([header, body]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The image without metadata, and its type. Throws for anything that is not a JPEG, PNG or WebP. */
export function stripImageMetadata(bytes: Uint8Array): { bytes: Uint8Array; contentType: ListingImageType } {
  const contentType = sniffImage(bytes);
  if (!contentType) throw new ImageRejectedError('NOT_AN_IMAGE');
  const stripped = contentType === 'image/jpeg' ? stripJpeg(bytes) : contentType === 'image/png' ? stripPng(bytes) : stripWebp(bytes);
  return { bytes: stripped, contentType };
}
