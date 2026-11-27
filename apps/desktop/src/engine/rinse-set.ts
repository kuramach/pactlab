import { createHash, randomUUID } from 'node:crypto';
import {
  RINSE_MANIFEST_SCHEMA,
  RINSE_MANIFEST_VERSION,
  rinseManifestSchema,
  type RinseManifest,
  type RinseManifestDocument,
} from '@pactlab/contracts';
import {
  auditConversion,
  categoriesForPack,
  fileChecks,
  findDuplicates,
  HAND_ENTRY_FORMS,
  HAND_ENTRY_VERSION,
  inspectFile,
  isClutter,
  packFor,
  readDocument,
  renderHandEntry,
  rinseGaps,
  rinseReadiness,
  unreadablePages,
  validateHandEntry,
  type AuditMismatch,
  type CheckResolution,
  type CompanyType,
  type ConversionAudit,
  type Enterer,
  type ExpectedInputId,
  type FileInspection,
  type GapResolution,
  type HandEntryFormId,
  type HandFieldProblem,
  type HandRow,
  type RinseCheck,
  type RinseCheckCode,
} from '@pactlab/domain';
import { unzipSync } from 'fflate';
import { AiQueue, type Classification, type RinseAiClient } from './ai-queue';
import { ConversionError, type Converter } from './converter';
import { writeLinesPdf } from './pdf';
import { readOriginalText } from './readers';

export const RINSE_APP_VERSION = '0.1.0';
const MAX_ARCHIVE_ENTRIES = 500;
const MAX_ARCHIVE_EXPANDED_BYTES = 500 * 1024 * 1024;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
const mediaTypeOf = (path: string) => MEDIA_TYPES[(path.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';

type Step = RinseManifestDocument['conversionLog'][number];

interface RinseFile {
  readonly id: string;
  path: string;
  bytes: Uint8Array;
  sha256: string;
  inspection: FileInspection;
  converted: { pdf: Uint8Array; sha256: string; pageTexts: string[]; anchors: string[]; tool: string } | null;
  conversionFailed: string | null;
  original: { pageTexts: string[] | null; fixedPages: boolean; readBy: 'TEXT_LAYER' | 'VISION' } | null;
  audit: ConversionAudit | null;
  /** Mismatches a later re-run or replacement cleared, kept for the manifest. */
  resolvedMismatches: (AuditMismatch & { resolution: 'RERUN' | 'REPLACED' })[];
  classification: (Classification & { by: 'AI' | 'PERSON' }) | null;
  excluded: boolean;
  resolutions: Map<RinseCheckCode, { kind: CheckResolution; note: string | null }>;
  log: Step[];
}

interface HandEntry {
  readonly id: string;
  form: HandEntryFormId;
  rows: HandRow[];
  revision: number;
  enteredAt: string;
  document: { pdf: Uint8Array; sha256: string; pageTexts: string[]; anchors: string[] };
}

export interface RinseSetOptions {
  readonly name: string;
  readonly companyType: CompanyType;
  readonly currency: string;
  /** The signed-in preparer: required, it is what makes the finished set trustworthy. */
  readonly preparer: Enterer;
  /** Set when a prep invite bound the set to its pact; the binding is checked again at sync (T-178b). */
  readonly intendedPact?: { organizationId: string; dealId: string; bindingId?: string } | null;
  readonly converter: Converter;
  readonly queue?: AiQueue;
  readonly clock?: () => Date;
  readonly newId?: () => string;
}

export interface FileView {
  readonly id: string;
  readonly path: string;
  readonly kind: FileInspection['kind'];
  readonly route: FileInspection['route'];
  readonly excluded: boolean;
  readonly category: string | null;
  readonly checks: RinseCheck[];
  readonly audit: ConversionAudit | null;
  readonly duplicateOf: string | null;
}

/**
 * One document set on the seller's machine: rinse → gaps → fix → re-rinse until clean. Deterministic
 * checks and conversion run offline; AI steps queue until the preparer is online and signed in.
 */
export class RinseSet {
  readonly id: string;
  private readonly files: RinseFile[] = [];
  private readonly hand: HandEntry[] = [];
  private readonly gapNotes = new Map<ExpectedInputId, GapResolution>();
  private readonly createdAt: string;
  private readonly queue: AiQueue;
  private readonly clock: () => Date;
  private readonly newId: () => string;
  private online = false;

  constructor(private readonly options: RinseSetOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
    this.queue = options.queue ?? AiQueue.memory();
    this.id = this.newId();
    this.createdAt = this.clock().toISOString();
  }

  private get pack() {
    return packFor(this.options.companyType);
  }

  private step(step: Step['step'], tool: string, detail: string | null = null): Step {
    return { at: this.clock().toISOString(), step, tool, detail };
  }

  /** Add a file (or a zip, unpacked once, bounded before inflating). Clutter is skipped. Returns what was added. */
  add(path: string, bytes: Uint8Array): string[] {
    const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (isClutter(clean)) return [];
    const inspection = inspectFile(clean, bytes);
    if (inspection.route === 'UNPACK' && !inspection.corrupt) {
      const folder = clean.replace(/\.zip$/i, '');
      let count = 0;
      let expanded = 0;
      const entries = unzipSync(bytes, {
        filter: (entry) => {
          count += 1;
          expanded += entry.originalSize;
          return !entry.name.endsWith('/') && count <= MAX_ARCHIVE_ENTRIES && expanded <= MAX_ARCHIVE_EXPANDED_BYTES;
        },
      });
      return Object.entries(entries).flatMap(([name, content]) => (name.toLowerCase().endsWith('.zip') ? [] : this.add(`${folder}/${name}`, content)));
    }
    const file: RinseFile = {
      id: this.newId(),
      path: this.uniquePath(clean),
      bytes,
      sha256: sha256(bytes),
      inspection,
      converted: null,
      conversionFailed: null,
      original: null,
      audit: null,
      resolvedMismatches: [],
      classification: null,
      excluded: false,
      resolutions: new Map(),
      log: [this.step('INSPECTED', 'rinse-1', inspection.corrupt)],
    };
    this.files.push(file);
    return [file.id];
  }

  private uniquePath(path: string): string {
    if (!this.files.some((file) => file.path === path)) return path;
    const dot = path.lastIndexOf('.');
    for (let n = 2; ; n += 1) {
      const candidate = dot > 0 ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`;
      if (!this.files.some((file) => file.path === candidate)) return candidate;
    }
  }

  private file(id: string): RinseFile {
    const file = this.files.find((entry) => entry.id === id);
    if (!file) throw new Error('Unknown file');
    return file;
  }

  /**
   * Rinse every file not yet rinsed: convert, read the original independently, audit, and queue the AI
   * steps. With a client and the network, the queue runs now; otherwise it waits.
   */
  async rinse(input: { online: boolean; ai?: RinseAiClient }): Promise<void> {
    this.online = input.online;
    for (const file of this.files) {
      if (file.excluded || file.inspection.corrupt || file.inspection.route !== 'CONVERT' || file.converted) continue;
      await this.convert(file);
    }
    for (const file of this.files) if (!file.excluded && !file.inspection.corrupt) await this.queueAi(file);
    if (input.online && input.ai) {
      await this.queue.drain(input.ai, async (hash) => this.files.find((file) => file.sha256 === hash)?.bytes ?? new Uint8Array());
    }
    this.applyAiResults();
  }

  private async convert(file: RinseFile): Promise<void> {
    file.original = { ...(await readOriginalText(file.inspection.kind, file.bytes)), readBy: 'TEXT_LAYER' };
    try {
      const result = await this.options.converter.convert(file.path, file.bytes);
      file.converted = { pdf: result.pdf, sha256: sha256(result.pdf), pageTexts: result.pageTexts, anchors: result.anchors, tool: result.tool };
      file.conversionFailed = null;
      file.log.push(this.step('CONVERTED', result.tool), this.step('TEXT_EXTRACTED', result.tool));
    } catch (error) {
      file.conversionFailed = error instanceof ConversionError ? error.reason : 'FAILED';
      return;
    }
    this.audit(file);
  }

  /** Compare the original's own reading with the conversion's; a scan waits for the vision lane. */
  private audit(file: RinseFile): void {
    const pages = file.original?.pageTexts;
    if (!file.converted || !pages || unreadablePages(pages).length === pages.length) return;
    const original = readDocument(pages);
    const converted = readDocument(file.converted.pageTexts);
    const before = file.audit?.mismatches ?? [];
    file.audit = auditConversion(file.original?.fixedPages ? original : { ...original, pages: converted.pages }, converted);
    // Mismatches a re-run cleared are kept, resolved, for the manifest.
    for (const mismatch of before) {
      if (!file.audit.mismatches.some((now) => now.kind === mismatch.kind && now.label === mismatch.label)) file.resolvedMismatches.push({ ...mismatch, resolution: 'RERUN' });
    }
    file.log.push(this.step('AUDITED', file.audit.version, `${file.audit.figuresMatched} of ${file.audit.figuresCompared} figures matched`));
  }

  private async queueAi(file: RinseFile): Promise<void> {
    if (!file.classification) {
      const pageTexts = file.converted?.pageTexts ?? file.original?.pageTexts ?? [new TextDecoder().decode(file.bytes.subarray(0, 12_000))];
      await this.queue.enqueue({ kind: 'CLASSIFY', sha256: file.sha256, fileName: file.path, pageTexts: pageTexts.slice(0, 3), categories: categoriesForPack(this.pack).map((category) => category.id) });
    }
    const pages = file.original?.pageTexts;
    const scan = file.inspection.route === 'CONVERT' && (!pages || unreadablePages(pages).length === pages.length) && file.original?.readBy !== 'VISION';
    if (scan) await this.queue.enqueue({ kind: 'VISION', sha256: file.sha256, fileName: file.path, pages: file.converted?.pageTexts.length ?? 1 });
  }

  private applyAiResults(): void {
    for (const file of this.files) {
      const cached = this.queue.cached(file.sha256);
      if (cached.classification && !file.classification) {
        file.classification = { ...cached.classification, by: 'AI' };
        file.log.push(this.step('CLASSIFIED', cached.classification.promptVersion));
      }
      if (cached.vision && file.original?.readBy !== 'VISION') {
        file.original = { pageTexts: cached.vision, fixedPages: true, readBy: 'VISION' };
        file.log.push(this.step('VISION_READ', 'document.vision@1'));
        this.audit(file);
      }
    }
  }

  // --- The seller fixes the gaps --------------------------------------------------------------------

  /** Choose what a document is; the seller's choice wins over the AI's. */
  classify(id: string, category: string): void {
    const file = this.file(id);
    file.classification = { category, confidence: 1, promptVersion: 'person', by: 'PERSON' };
    file.log.push(this.step('CLASSIFIED', 'person'));
  }

  exclude(id: string): void {
    this.file(id).excluded = true;
  }

  /** Replace a file with a good copy (a corrupt file, a re-scan, a corrected statement): rinsed afresh. */
  replace(id: string, bytes: Uint8Array): void {
    const file = this.file(id);
    for (const mismatch of file.audit?.mismatches ?? []) file.resolvedMismatches.push({ ...mismatch, resolution: 'REPLACED' });
    Object.assign(file, { bytes, sha256: sha256(bytes), inspection: inspectFile(file.path, bytes), converted: null, original: null, audit: null, conversionFailed: null, classification: file.classification?.by === 'PERSON' ? file.classification : null });
    file.resolutions.clear();
    file.log.push(this.step('INSPECTED', 'rinse-1', 'replaced'));
  }

  /** Re-run a file's conversion (after fixing a tool setting, or with another converter). */
  async rerun(id: string, converter: Converter = this.options.converter): Promise<void> {
    const file = this.file(id);
    const result = await converter.convert(file.path, file.bytes);
    file.converted = { pdf: result.pdf, sha256: sha256(result.pdf), pageTexts: result.pageTexts, anchors: result.anchors, tool: result.tool };
    file.log.push(this.step('CONVERTED', result.tool, 're-run'));
    this.audit(file);
  }

  /** Keep a warning with a note (a near duplicate that is a genuine second copy, say). Errors cannot be kept. */
  keepWithNote(id: string, code: RinseCheckCode, note: string): void {
    this.file(id).resolutions.set(code, { kind: 'KEPT_WITH_NOTE', note });
  }

  /** Mark a gap not applicable, or noted (to follow), with the seller's note. */
  noteGap(input: ExpectedInputId, kind: 'NOT_APPLICABLE' | 'NOTED', note: string): void {
    if (note.trim().length < 3) throw new Error('A note is required');
    this.gapNotes.set(input, { input, kind, note: note.trim() });
  }

  /** Close a gap by entering the data: Rinse generates the stamped canonical document. Editable until upload. */
  async enterByHand(form: HandEntryFormId, rows: readonly HandRow[], id?: string): Promise<{ id: string | null; problems: HandFieldProblem[] }> {
    const checked = validateHandEntry(form, rows);
    if (checked.problems.length > 0) return { id: null, problems: checked.problems };
    const existing = id ? this.hand.find((entry) => entry.id === id) : undefined;
    const enteredAt = this.clock().toISOString();
    const lines = renderHandEntry(form, checked.rows, this.options.preparer, enteredAt, this.options.currency);
    const pdf = await writeLinesPdf(lines.slice(1), { title: HAND_ENTRY_FORMS[form].label, stamp: lines[0] ?? '' });
    const document = { pdf: pdf.bytes, sha256: sha256(pdf.bytes), pageTexts: pdf.pageTexts, anchors: pdf.anchors };
    if (existing) {
      Object.assign(existing, { form, rows: checked.rows, revision: existing.revision + 1, enteredAt, document });
      return { id: existing.id, problems: [] };
    }
    const entry: HandEntry = { id: this.newId(), form, rows: checked.rows, revision: 1, enteredAt, document };
    this.hand.push(entry);
    return { id: entry.id, problems: [] };
  }

  // --- What the seller sees -------------------------------------------------------------------------

  private duplicates() {
    const live = this.files.filter((file) => !file.excluded && !file.inspection.corrupt);
    return new Map(findDuplicates(live.map((file) => ({ id: file.id, sha256: file.sha256, text: file.converted?.pageTexts.join('\n') ?? null }))).map((match) => [match.id, match]));
  }

  private checksOf(file: RinseFile, duplicates: ReturnType<RinseSet['duplicates']>): RinseCheck[] {
    const duplicate = duplicates.get(file.id);
    const pages = file.original?.pageTexts ?? null;
    const checks = fileChecks({
      inspection: file.inspection,
      duplicateOf: duplicate ? { name: this.file(duplicate.of).path, kind: duplicate.kind } : null,
      unreadablePages: file.inspection.route === 'CONVERT' && !file.inspection.corrupt ? (pages ? unreadablePages(pages) : (file.converted?.pageTexts ?? ['']).map((_, index) => index + 1)) : [],
      visionRead: file.original?.readBy === 'VISION' && (file.original.pageTexts ?? []).every((page) => unreadablePages([page]).length === 0),
      online: this.online,
      classified: file.classification !== null || file.inspection.kind === 'UNSUPPORTED',
      audit: file.audit,
    });
    if (file.conversionFailed) checks.push({ code: 'CORRUPT', severity: 'ERROR', message: `The conversion did not complete (${file.conversionFailed.toLowerCase().replace(/_/g, ' ')}). Re-run it, or replace the file.`, resolution: null });
    return checks.map((item) => ({ ...item, resolution: file.resolutions.get(item.code) ?? null }));
  }

  view(): { files: FileView[]; gaps: ReturnType<typeof rinseGaps>; readiness: ReturnType<typeof rinseReadiness>; handEntries: { id: string; form: HandEntryFormId; revision: number }[]; aiWaiting: number } {
    const duplicates = this.duplicates();
    const files = this.files.map((file) => ({
      id: file.id,
      path: file.path,
      kind: file.inspection.kind,
      route: file.inspection.route,
      excluded: file.excluded,
      category: file.classification?.category ?? null,
      checks: file.excluded ? [] : this.checksOf(file, duplicates),
      audit: file.audit,
      duplicateOf: duplicates.get(file.id)?.of ?? null,
    }));
    const gaps = rinseGaps(
      this.pack,
      [
        ...files.map((file) => ({ id: file.id, category: file.category, excluded: file.excluded || file.kind === 'UNSUPPORTED', flagged: file.checks.some((item) => item.severity !== 'INFO'), handEntry: null })),
        ...this.hand.map((entry) => ({ id: entry.id, category: null, excluded: false, flagged: false, handEntry: entry.form })),
      ],
      [...this.gapNotes.values()],
    );
    return { files, gaps, readiness: rinseReadiness(files.flatMap((file) => file.checks), gaps), handEntries: this.hand.map((entry) => ({ id: entry.id, form: entry.form, revision: entry.revision })), aiWaiting: this.queue.pending().length };
  }

  // --- The finished set -----------------------------------------------------------------------------

  /** The manifest of a ready set. A set with an unresolved error or an open required gap has none. */
  manifest(): RinseManifest {
    const view = this.view();
    if (!view.readiness.ready) throw new Error('The set is not ready');
    const byId = new Map(view.files.map((file) => [file.id, file]));
    const documents: RinseManifestDocument[] = [];
    for (const file of this.files) {
      const shown = byId.get(file.id);
      if (!shown || file.excluded || file.inspection.kind === 'UNSUPPORTED') continue;
      const reading = file.original?.pageTexts ? readDocument(file.original.pageTexts) : null;
      documents.push({
        id: file.id,
        source: 'FILE',
        original: { path: file.path, sha256: file.sha256, sizeBytes: file.bytes.byteLength, mediaType: mediaTypeOf(file.path) },
        converted: file.converted ? { path: convertedPath(file.path), sha256: file.converted.sha256, sizeBytes: file.converted.pdf.byteLength, mediaType: 'application/pdf', pages: file.converted.pageTexts.length, anchors: file.converted.anchors } : null,
        route: file.inspection.route === 'CONVERT' ? 'CONVERT' : file.inspection.route === 'GUIDED_IMPORT' ? 'GUIDED_IMPORT' : 'NONE',
        classification: file.classification ? { category: file.classification.category, by: file.classification.by, confidence: file.classification.by === 'PERSON' ? null : file.classification.confidence, promptVersion: file.classification.by === 'PERSON' ? null : file.classification.promptVersion } : null,
        metadata: { title: file.path.split('/').pop() ?? null, dates: reading?.dates.slice(0, 50) ?? [], parties: reading?.parties.slice(0, 50) ?? [] },
        checks: shown.checks.map((item) => ({ code: item.code, severity: item.severity, message: item.message, resolution: item.resolution })),
        conversionLog: [...file.log, ...(file.inspection.route === 'GUIDED_IMPORT' ? [this.step('PACKAGED_FOR_IMPORT', 'rinse-1')] : [])],
        audit: file.audit
          ? {
              version: file.audit.version,
              originalReadBy: file.original?.readBy ?? 'TEXT_LAYER',
              figuresCompared: file.audit.figuresCompared,
              figuresMatched: file.audit.figuresMatched,
              pages: { ...file.audit.pages },
              tables: { ...file.audit.tables },
              mismatches: file.resolvedMismatches.map((mismatch) => ({ kind: mismatch.kind, label: mismatch.label, original: { ...mismatch.original }, converted: { ...mismatch.converted }, resolution: mismatch.resolution })),
              sourceDiscrepancies: file.audit.sourceDiscrepancies.map((discrepancy) => ({ ...discrepancy })),
            }
          : null,
        handEntry: null,
        duplicateOf: shown.duplicateOf,
      });
    }
    for (const entry of this.hand) {
      const form = HAND_ENTRY_FORMS[entry.form];
      documents.push({
        id: entry.id,
        source: 'HAND_ENTRY',
        original: null,
        converted: { path: `hand-sourced/${form.label}.pdf`, sha256: entry.document.sha256, sizeBytes: entry.document.pdf.byteLength, mediaType: 'application/pdf', pages: entry.document.pageTexts.length, anchors: entry.document.anchors },
        route: 'CONVERT',
        classification: form.covers[0] ? { category: form.covers[0], by: 'PERSON', confidence: null, promptVersion: null } : null,
        metadata: { title: form.label, dates: [], parties: [] },
        checks: [],
        conversionLog: [{ at: entry.enteredAt, step: 'GENERATED', tool: HAND_ENTRY_VERSION, detail: `revision ${entry.revision}` }],
        audit: null,
        handEntry: { form: entry.form, formVersion: HAND_ENTRY_VERSION, rows: entry.rows.map((row) => ({ ...row })), currency: this.options.currency, enteredBy: { ...this.options.preparer }, enteredAt: entry.enteredAt, revision: entry.revision },
        duplicateOf: null,
      });
    }
    const manifest: RinseManifest = {
      schema: RINSE_MANIFEST_SCHEMA,
      version: RINSE_MANIFEST_VERSION,
      generator: { app: 'Pactlab Rinse', version: RINSE_APP_VERSION },
      set: { id: this.id, name: this.options.name, pack: this.options.companyType, createdAt: this.createdAt, readyAt: this.clock().toISOString(), preparedBy: { ...this.options.preparer }, intendedPact: this.options.intendedPact ?? null },
      documents,
      gaps: view.gaps.map((gap) => ({ input: gap.input, label: gap.label, need: gap.need, state: gap.state, note: gap.note, documentIds: gap.documentIds.filter((documentId) => documents.some((document) => document.id === documentId)) })),
    };
    // What is written is exactly what the pact accepts.
    return rinseManifestSchema.parse(manifest);
  }

  /** Every file of the finished set, by its path inside the folder: originals, canonical copies, hand-sourced documents. */
  output(manifest: RinseManifest): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const document of manifest.documents) {
      if (document.source === 'FILE') {
        const file = this.file(document.id);
        if (document.original) out.set(document.original.path, file.bytes);
        if (document.converted && file.converted) out.set(document.converted.path, file.converted.pdf);
      } else {
        const entry = this.hand.find((hand) => hand.id === document.id);
        if (entry && document.converted) out.set(document.converted.path, entry.document.pdf);
      }
    }
    return out;
  }
}

/** Where a document's canonical copy sits in the finished folder: beside the originals, under `rinsed/`. */
export function convertedPath(path: string): string {
  return `rinsed/${path.replace(/\.[^./]+$/, '')}.pdf`;
}
