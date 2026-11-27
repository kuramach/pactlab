import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { extensionOf } from '@pactlab/domain';
import { docxText } from './readers';
import { readPdfText, writeLinesPdf } from './pdf';

/**
 * Conversion to the canonical form, on the seller's machine (T-178). The converter is a port: the
 * desktop bundles local tools (office-to-PDF, PDF normalization, OCR for scans); tests use the
 * deterministic writer. Originals are never modified: a conversion only ever writes a new file.
 */
export interface Conversion {
  readonly pdf: Uint8Array;
  /** The converted document's text layer, page by page: what the audit compares against the original. */
  readonly pageTexts: string[];
  readonly anchors: string[];
  readonly tool: string;
}

export class ConversionError extends Error {
  constructor(readonly reason: 'TOOL_MISSING' | 'FAILED' | 'NO_TEXT') {
    super(`Conversion: ${reason}`);
    this.name = 'ConversionError';
  }
}

export interface Converter {
  readonly tool: string;
  convert(name: string, bytes: Uint8Array): Promise<Conversion>;
}

/**
 * The deterministic converter: Word and text become a canonical PDF of their lines; a PDF's text layer is
 * re-laid onto canonical pages. Scans need OCR, which only the bundled tools provide: here they fail with
 * NO_TEXT unless the caller supplies the OCR text.
 */
export class LinesConverter implements Converter {
  readonly tool = 'rinse-lines-1';

  constructor(private readonly ocr: (name: string) => string[] | null = () => null) {}

  async convert(name: string, bytes: Uint8Array): Promise<Conversion> {
    const extension = extensionOf(name);
    let lines: string[] | null;
    if (extension === 'docx') lines = docxText(bytes)?.split('\n') ?? null;
    else if (extension === 'txt' || extension === 'md') lines = new TextDecoder().decode(bytes).split(/\r?\n/);
    else if (extension === 'pdf') {
      const pages = await readPdfText(bytes);
      // A PDF with no text layer is a scan: its text comes from OCR.
      lines = pages && pages.join('').trim().length > 0 ? pages.join('\n').split('\n') : (this.ocr(name)?.join('\n').split('\n') ?? null);
    } else lines = this.ocr(name)?.join('\n').split('\n') ?? null;
    if (!lines) throw new ConversionError('NO_TEXT');
    const pdf = await writeLinesPdf(lines, { title: basename(name, extname(name)) });
    return { pdf: pdf.bytes, pageTexts: pdf.pageTexts, anchors: pdf.anchors, tool: this.tool };
  }
}

function run(command: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', timeout: timeoutMs });
    child.on('error', (error: NodeJS.ErrnoException) => reject(new ConversionError(error.code === 'ENOENT' ? 'TOOL_MISSING' : 'FAILED')));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new ConversionError('FAILED'))));
  });
}

/**
 * The bundled local tools: LibreOffice (headless) for office-to-PDF, then the PDF's text layer read back
 * exactly as the pact reads it. Tools are named by path (bundled with the app), never fetched. Not
 * exercised in CI, where no office suite is installed; it fails closed with TOOL_MISSING.
 */
export class LocalToolConverter implements Converter {
  readonly tool = 'libreoffice-headless';

  constructor(private readonly soffice: string, private readonly timeoutMs = 120_000) {}

  async convert(name: string, bytes: Uint8Array): Promise<Conversion> {
    const workdir = await mkdtemp(join(tmpdir(), 'pactlab-rinse-'));
    try {
      const input = join(workdir, `input${extname(name).toLowerCase()}`);
      await writeFile(input, bytes);
      await run(this.soffice, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', workdir, input], this.timeoutMs);
      const pdf = new Uint8Array(await readFile(join(workdir, 'input.pdf')));
      const pageTexts = await readPdfText(pdf);
      if (!pageTexts) throw new ConversionError('FAILED');
      return { pdf, pageTexts, anchors: pageTexts.map((_, index) => `p${index + 1}`), tool: this.tool };
    } finally {
      // The scratch copy is destroyed whatever happens.
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

/**
 * Where the converters bundled into the installer live (T-178b, Kumar's decision 3): LibreOffice
 * (headless, office to PDF) and Tesseract (OCR), under the app's resources, fetched at build time and
 * pinned by SHA-256 (`apps/desktop/converters.lock.json`). A build without them fails closed with
 * TOOL_MISSING, as before.
 */
export function bundledTools(resources: string, os: NodeJS.Platform = process.platform): { soffice: string; tesseract: string; tessdata: string } {
  const exe = os === 'win32' ? '.exe' : '';
  const soffice = os === 'darwin' ? `${resources}/vendor/libreoffice/LibreOffice.app/Contents/MacOS/soffice` : `${resources}/vendor/libreoffice/program/soffice${exe}`;
  return { soffice, tesseract: `${resources}/vendor/tesseract/bin/tesseract${exe}`, tessdata: `${resources}/vendor/tesseract/tessdata` };
}
