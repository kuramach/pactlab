import type { ModelImage } from '@pactlab/ai';
import { unzipSync, strFromU8 } from 'fflate';

/**
 * Images of a document's pages for the vision step (T-121): a PDF page rendered to PNG, an uploaded image,
 * a PowerPoint slide's pictures and charts, or the pictures inside a Word or Excel file. Only the bytes
 * given are read; nothing is fetched.
 */

/** The longest side a rendered page gets, in pixels: legible small print, a modest image. */
const RENDER_LONG_SIDE = 1600;
/** A larger image is not sent (it is reported as too large to read). */
export const MAX_IMAGE_BYTES = 3_500_000;
/** At most this many pages of one document are read from images. */
export const MAX_VISION_PAGES = 60;

const FORMATS: Record<string, ModelImage['format']> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };
const formatOf = (name: string): ModelImage['format'] | null => FORMATS[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;

/** Render one PDF page to PNG, scaled so its longest side is about 1600 px. */
export async function renderPdfPage(bytes: Uint8Array, pageNumber: number): Promise<ModelImage> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, enableXfa: false, disableRange: true, disableStream: true, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: RENDER_LONG_SIDE / Math.max(base.width, base.height) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    // White background: scans and charts read better than on transparency.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    // @napi-rs/canvas stands in for the browser canvas pdfjs renders to (its Node canvas factory uses the same package).
    await page.render({ canvas, canvasContext: context, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
    return { format: 'png', bytes: new Uint8Array(await canvas.encode('png')) };
  } finally {
    await task.destroy();
  }
}

/**
 * A picture ready to send: scaled down when its longest side is over about 1600 px or it is too large, and
 * re-encoded as PNG. Returns null when it cannot be decoded (e.g. a vector EMF in an Office file).
 */
export async function fitImage(image: ModelImage): Promise<ModelImage | null> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  let decoded;
  try {
    decoded = await loadImage(Buffer.from(image.bytes));
  } catch {
    return null;
  }
  const longest = Math.max(decoded.width, decoded.height);
  if (longest <= RENDER_LONG_SIDE && image.bytes.length <= MAX_IMAGE_BYTES) return image;
  const scale = Math.min(1, RENDER_LONG_SIDE / longest);
  const canvas = createCanvas(Math.max(1, Math.round(decoded.width * scale)), Math.max(1, Math.round(decoded.height * scale)));
  canvas.getContext('2d').drawImage(decoded, 0, 0, canvas.width, canvas.height);
  const bytes = new Uint8Array(await canvas.encode('png'));
  return bytes.length <= MAX_IMAGE_BYTES ? { format: 'png', bytes } : null;
}

/** Which pages of a text PDF carry pictures (image paint operations): a chart or an image table may be there. */
export async function pdfPagesWithImages(bytes: Uint8Array): Promise<Set<number>> {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const paints = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, enableXfa: false, disableRange: true, disableStream: true, verbosity: 0 });
  const found = new Set<number>();
  try {
    const pdf = await task.promise;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const operators = await (await pdf.getPage(number)).getOperatorList();
      if (operators.fnArray.some((fn: number) => paints.has(fn))) found.add(number);
    }
  } finally {
    await task.destroy();
  }
  return found;
}

const xmlText = (xml: string) =>
  [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
    .map((match) => (match[1] ?? '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'"))
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

/** A PowerPoint deck: one entry per slide, in order, with its text, speaker notes and the pictures on it. */
export function pptxSlides(bytes: Uint8Array): { number: number; text: string; images: string[] }[] {
  const files = unzipSync(bytes);
  const slideNames = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  return slideNames.map((name, index) => {
    const number = Number(/(\d+)\.xml$/.exec(name)?.[1]);
    const rels = files[`ppt/slides/_rels/slide${number}.xml.rels`];
    const targets = rels ? [...strFromU8(rels).matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((match) => `ppt/media/${match[1]}`) : [];
    const notesRels = rels ? /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(strFromU8(rels))?.[1] : undefined;
    const notes = notesRels && files[`ppt/notesSlides/${notesRels}`] ? xmlText(strFromU8(files[`ppt/notesSlides/${notesRels}`] as Uint8Array)) : '';
    const text = xmlText(strFromU8(files[name] as Uint8Array));
    return { number: index + 1, text: [text, notes ? `Speaker notes: ${notes}` : ''].filter(Boolean).join('\n\n'), images: [...new Set(targets)].filter((target) => formatOf(target) && files[target]) };
  });
}

/** The pictures inside a Word, Excel or PowerPoint file (its media folder), in a stable order. */
export function officeMedia(bytes: Uint8Array, folder: 'word/media/' | 'xl/media/' | 'ppt/media/'): string[] {
  const files = unzipSync(bytes, { filter: (file) => file.name.startsWith(folder) });
  return Object.keys(files)
    .filter((name) => formatOf(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** One named picture from an Office file. */
export function officeImage(bytes: Uint8Array, name: string): ModelImage | null {
  const format = formatOf(name);
  const file = unzipSync(bytes, { filter: (entry) => entry.name === name })[name];
  return format && file ? { format, bytes: file } : null;
}
