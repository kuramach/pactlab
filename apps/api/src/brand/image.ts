/** What a logo file is, from its bytes (never its name or the server's word), and its size. */
export type LogoType = 'image/png' | 'image/jpeg' | 'image/svg+xml';

export function sniffLogo(bytes: Buffer): { type: LogoType; width: number | null; height: number | null } | null {
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // The first start-of-frame marker carries the size.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1] ?? 0;
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'image/jpeg', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
    return { type: 'image/jpeg', width: null, height: null };
  }
  const head = bytes.subarray(0, 2048).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    const tag = /<svg[^>]*>/i.exec(head)?.[0] ?? '';
    const number = (name: string) => Number(new RegExp(`${name}="([0-9.]+)`).exec(tag)?.[1] ?? NaN);
    const box = /viewBox="[^"]*?([0-9.]+)\s+([0-9.]+)"/i.exec(tag);
    const width = Number.isFinite(number('width')) ? number('width') : box ? Number(box[1]) : NaN;
    const height = Number.isFinite(number('height')) ? number('height') : box ? Number(box[2]) : NaN;
    return { type: 'image/svg+xml', width: Number.isFinite(width) ? Math.round(width) : null, height: Number.isFinite(height) ? Math.round(height) : null };
  }
  return null;
}

/** The most saturated colors a PNG palette (PLTE) declares, if it has one: a cheap brand-color guess. */
export function pngPaletteColor(bytes: Buffer): string | null {
  let offset = 8;
  while (offset + 8 < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'PLTE') {
      let best: { hex: string; score: number } | null = null;
      for (let index = 0; index + 2 < length; index += 3) {
        const [r, g, b] = [bytes[offset + 8 + index] ?? 0, bytes[offset + 9 + index] ?? 0, bytes[offset + 10 + index] ?? 0];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const score = max === 0 ? 0 : (max - min) / max;
        if (score > 0.35 && max > 40 && (!best || score > best.score)) best = { hex: `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`, score };
      }
      return best?.hex ?? null;
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    offset += 12 + length;
  }
  return null;
}
