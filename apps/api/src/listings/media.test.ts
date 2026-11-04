import { describe, expect, it } from 'vitest';
import { ImageRejectedError, sniffImage, stripImageMetadata } from './strip-image-metadata';
import { parseVideoUrl } from './video-url';

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : part)));
const contains = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));

// Synthetic, structurally valid files carrying fake location metadata.
const segment = (marker: number, payload: string) => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...bytes(payload)];
const JPEG = bytes([0xff, 0xd8], segment(0xe0, 'JFIF\0'), segment(0xe1, 'Exif\0\0GPS 51.5N 0.12W'), segment(0xfe, 'secret comment'), [0xff, 0xda, 0x00, 0x02], 'SCANDATA', [0xff, 0xd9]);
const chunk = (type: string, data: string) => {
  const length = data.length;
  return [(length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff, ...bytes(type, data), 0, 0, 0, 0];
};
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', 'HEADER13BYTES'), chunk('tEXt', 'Author\0Secret Person'), chunk('eXIf', 'GPS 51.5N'), chunk('IDAT', 'PIXELS'), chunk('IEND', ''));
const riff = (type: string, data: string) => {
  const size = data.length;
  return [...bytes(type), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff, ...bytes(data), ...(size % 2 ? [0] : [])];
};
const webpBody = [...bytes('WEBP'), ...riff('VP8X', '\x0c\0\0\0\0\0\0\0\0\0'), ...riff('VP8 ', 'PIXELDATA'), ...riff('EXIF', 'GPS 51.5N'), ...riff('XMP ', '<x:creator>Secret</x:creator>')];
const WEBP = bytes('RIFF', [webpBody.length & 0xff, (webpBody.length >> 8) & 0xff, 0, 0], webpBody);

describe('listing image metadata', () => {
  it('recognises JPEG, PNG and WebP by their bytes, nothing else', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(() => stripImageMetadata(bytes('%PDF-1.7'))).toThrow(ImageRejectedError);
  });

  it('drops EXIF and comments from a JPEG and keeps the image data', () => {
    const { bytes: out, contentType } = stripImageMetadata(JPEG);
    expect(contentType).toBe('image/jpeg');
    expect(contains(out, 'GPS')).toBe(false);
    expect(contains(out, 'secret comment')).toBe(false);
    expect(contains(out, 'JFIF')).toBe(true);
    expect(contains(out, 'SCANDATA')).toBe(true);
    expect([...out.subarray(-2)]).toEqual([0xff, 0xd9]);
  });

  it('drops text and EXIF chunks from a PNG', () => {
    const out = stripImageMetadata(PNG).bytes;
    expect(contains(out, 'Secret Person')).toBe(false);
    expect(contains(out, 'GPS')).toBe(false);
    for (const kept of ['IHDR', 'IDAT', 'PIXELS', 'IEND']) expect(contains(out, kept)).toBe(true);
  });

  it('drops EXIF and XMP from a WebP, clears their flags and fixes the size', () => {
    const out = stripImageMetadata(WEBP).bytes;
    expect(contains(out, 'GPS')).toBe(false);
    expect(contains(out, 'Secret')).toBe(false);
    expect(contains(out, 'PIXELDATA')).toBe(true);
    expect(out[4]! | (out[5]! << 8)).toBe(out.length - 8);
    const vp8x = Buffer.from(out).indexOf('VP8X');
    expect(out[vp8x + 8]! & 0b1100).toBe(0);
  });

  it('refuses a truncated image', () => {
    expect(() => stripImageMetadata(JPEG.subarray(0, 12))).toThrow(ImageRejectedError);
  });
});

describe('listing video links', () => {
  it('reduces YouTube and Vimeo links to provider and id', () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ']) {
      expect(parseVideoUrl(url), url).toEqual({ provider: 'YOUTUBE', id: 'dQw4w9WgXcQ' });
    }
    expect(parseVideoUrl('https://vimeo.com/76979871')).toEqual({ provider: 'VIMEO', id: '76979871' });
    expect(parseVideoUrl('https://player.vimeo.com/video/76979871')).toEqual({ provider: 'VIMEO', id: '76979871' });
  });

  it('refuses anything else', () => {
    for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'https://evil.example/youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=bad', 'https://vimeo.com/channels/staff', 'not a url', 'ftp://youtu.be/dQw4w9WgXcQ']) {
      expect(parseVideoUrl(url), url).toBeNull();
    }
  });
});
