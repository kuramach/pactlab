import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRinseManifest, RINSE_MANIFEST_FILE, rinseManifestSchema } from '@pactlab/contracts';
import { matchRinsedFile, readRinsedFolder, type DocumentSourceAdapter, type SourceFile } from '@pactlab/connectors';
import { afterEach, describe, expect, it } from 'vitest';
import { AiQueue, OFFLINE_AI } from './ai-queue';
import { bundledTools, ConversionError, LinesConverter, LocalToolConverter } from './converter';
import { goodLease, messySet, OPERATING_SCAN_MISREAD, OPERATING_SCAN_TRUE, scriptedAi, sha, docx } from './fixture-set';
import { FolderDestination, readFolder } from './folders';
import { readPdfText } from './pdf';
import { RinseSet } from './rinse-set';

const PREPARER = { userId: '0193a1b2-0000-7000-8000-00000000a001', name: 'Dana Whitlow', organization: 'Harbour Lane Apartments LLC (synthetic)' };
const scanOcr = (text: string[]) => (name: string) => (name.includes('Operating statement') ? [text.join('\n')] : null);
let counter = 0;
const ids = () => `0193a1b2-0000-7000-8000-${String((counter += 1)).padStart(12, '0')}`;

async function newSet(options: { queue?: AiQueue } = {}) {
  const set = new RinseSet({ name: 'Harbour Lane diligence set (synthetic)', companyType: 'MULTIFAMILY', currency: 'USD', preparer: PREPARER, converter: new LinesConverter(scanOcr(OPERATING_SCAN_MISREAD)), clock: () => new Date('2026-11-27T10:00:00Z'), newId: ids, ...options });
  for (const file of await messySet()) set.add(file.path, file.bytes);
  return set;
}

const fileBy = (set: RinseSet, path: string) => {
  const file = set.view().files.find((entry) => entry.path === path);
  if (!file) throw new Error(path);
  return file;
};
const codes = (set: RinseSet, path: string) => fileBy(set, path).checks.map((item) => item.code);

/** The finished folder, read as the pact reads a connected drive. */
function folderAdapter(files: { path: string; bytes: Uint8Array }[]): DocumentSourceAdapter {
  const listing: SourceFile[] = files.map((file) => {
    const slash = file.path.lastIndexOf('/');
    return { externalId: file.path, folder: slash < 0 ? '' : file.path.slice(0, slash), name: file.path.slice(slash + 1), mediaType: 'application/octet-stream', sizeBytes: file.bytes.byteLength, version: sha(file.bytes) };
  });
  return {
    provider: 'onedrive',
    mode: 'FIXTURE',
    list: async () => listing,
    read: async (_scope, _config, file) => files.find((entry) => entry.path === file.externalId)?.bytes ?? new Uint8Array(),
  };
}

const temporary: string[] = [];
afterEach(async () => {
  for (const folder of temporary.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe('Pactlab Rinse: a messy set, rinsed clean (T-178)', () => {
  it('rinses a mixed set: statements packaged for import, documents converted with page anchors, duplicate, corrupt, mis-read and gap flagged', async () => {
    const set = await newSet();
    await set.rinse({ online: true, ai: scriptedAi() });
    const view = set.view();
    expect(view.files.some((file) => file.path === '.DS_Store')).toBe(false);
    expect(fileBy(set, 'Rent roll/Rent roll Sept 2026.xlsx')).toMatchObject({ route: 'GUIDED_IMPORT', category: 'MULTIFAMILY_RENT_ROLL' });
    expect(codes(set, 'Rent roll/Rent roll Sept 2026.xlsx')).toEqual(['GUIDED_IMPORT']);
    expect(fileBy(set, 'Financials/Income statement FY2026.docx').audit).toMatchObject({ figuresCompared: 3, figuresMatched: 3, mismatches: [] });
    expect(codes(set, 'Financials/Copy of Income statement FY2026.docx')).toContain('EXACT_DUPLICATE');
    expect(codes(set, 'Leases/Retail unit lease.pdf')).toContain('CORRUPT');
    // The scan's conversion mis-read the revenue total; the vision lane's reading of the original caught it.
    const scan = fileBy(set, 'Scans/Operating statement FY2026.pdf');
    expect(scan.audit?.mismatches).toContainEqual({ kind: 'FIGURE', label: 'Total revenue', original: { value: '1700000', page: 1 }, converted: { value: '1100000', page: 1 } });
    expect(view.gaps.find((gap) => gap.input === 'MULTIFAMILY_OCCUPANCY')?.state).toBe('MISSING');
    expect(view.readiness.ready).toBe(false);
    expect(() => set.manifest()).toThrow('not ready');
  });

  it('once the gaps are closed, marks ready and emits a folder and manifest that verify against the schema and round-trip through the pact', async () => {
    const set = await newSet();
    await set.rinse({ online: true, ai: scriptedAi() });
    set.exclude(fileBy(set, 'Financials/Copy of Income statement FY2026.docx').id);
    set.replace(fileBy(set, 'Leases/Retail unit lease.pdf').id, await goodLease());
    await set.rerun(fileBy(set, 'Scans/Operating statement FY2026.pdf').id, new LinesConverter(scanOcr(OPERATING_SCAN_TRUE)));
    const hand = await set.enterByHand('VACANCY_SCHEDULE', [{ period: '2026-09', unitType: 'All', units: '120', occupiedUnits: '106', averageRent: '1,450.00' }]);
    expect(hand.problems).toEqual([]);
    set.noteGap('MULTIFAMILY_DELINQUENCY', 'NOTED', 'The manager is preparing the September delinquency report; it follows next week.');
    set.noteGap('MULTIFAMILY_INSPECTION', 'NOT_APPLICABLE', 'No unit inspection in the last two years.');
    await set.rinse({ online: true, ai: scriptedAi() });
    const view = set.view();
    expect(view.files.flatMap((file) => file.checks).filter((item) => item.severity === 'ERROR')).toEqual([]);
    expect(view.readiness).toMatchObject({ ready: true, openErrors: 0, openGaps: [] });

    const manifest = set.manifest();
    expect(rinseManifestSchema.safeParse(manifest).success).toBe(true);
    const scan = manifest.documents.find((document) => document.original?.path === 'Scans/Operating statement FY2026.pdf');
    expect(scan?.audit).toMatchObject({ originalReadBy: 'VISION', mismatches: expect.arrayContaining([expect.objectContaining({ kind: 'FIGURE', label: 'Total revenue', resolution: 'RERUN' }), expect.objectContaining({ kind: 'FOOTING', converted: { value: '1100000', page: 1 } })]) });
    const vacancy = manifest.documents.find((document) => document.source === 'HAND_ENTRY');
    expect(vacancy?.handEntry).toMatchObject({ form: 'VACANCY_SCHEDULE', enteredBy: PREPARER, revision: 1 });
    expect(manifest.documents.some((document) => document.original?.path.startsWith('Financials/Copy of'))).toBe(false);

    const parent = await mkdtemp(join(tmpdir(), 'rinse-out-'));
    temporary.push(parent);
    const written = await new FolderDestination(parent).write(set.output(manifest), manifest);
    const folder = await readFolder(written.location);
    expect(folder.map((file) => file.path)).toEqual(
      expect.arrayContaining([RINSE_MANIFEST_FILE, 'Financials/Income statement FY2026.docx', 'rinsed/Financials/Income statement FY2026.pdf', 'Rent roll/Rent roll Sept 2026.xlsx', 'hand-sourced/Vacancy and occupancy schedule.pdf']),
    );
    // The generated file is stamped on its page, and reads back to the values entered.
    const generated = folder.find((file) => file.path === 'hand-sourced/Vacancy and occupancy schedule.pdf');
    const text = (await readPdfText(generated?.bytes ?? new Uint8Array()))?.join('\n') ?? '';
    expect(text).toContain('Hand-sourced - entered by Dana Whitlow, Harbour Lane Apartments LLC (synthetic) on 2026-11-27');
    expect(text).toContain('Occupied units: 106');
    // Converted documents carry a text layer and one anchor per page.
    const income = manifest.documents.find((document) => document.converted?.path === 'rinsed/Financials/Income statement FY2026.pdf');
    expect(income?.converted?.anchors).toEqual(['p1']);

    // The manifest as written round-trips through the pact-side reader unchanged; every file matches it.
    const adapter = folderAdapter(folder);
    const listing = await adapter.list({ credentialRef: null }, { folder: '' });
    const read = await readRinsedFolder(adapter, { credentialRef: null }, { folder: '' }, listing);
    expect(read.status === 'READ' && read.manifest).toEqual(manifest);
    for (const file of listing.filter((entry) => entry.name !== RINSE_MANIFEST_FILE)) {
      expect(typeof matchRinsedFile(read, file, await adapter.read({ credentialRef: null }, { folder: '' }, file))).toBe('object');
    }
    // Writing again never overwrites the finished folder.
    await expect(new FolderDestination(parent).write(set.output(manifest), manifest)).rejects.toThrow();
  });

  it('an original that does not foot travels as a noted source discrepancy, not a conversion error', async () => {
    const set = new RinseSet({ name: 'Discrepancy', companyType: 'MULTIFAMILY', currency: 'USD', preparer: PREPARER, converter: new LinesConverter(), newId: ids });
    const [id] = set.add('Balance sheet.docx', docx(['Cash: USD 420,000', 'Tenant receivables: USD 38,000', 'Total current assets: USD 468,000']));
    await set.rinse({ online: true, ai: scriptedAi() });
    const file = set.view().files.find((entry) => entry.id === id);
    expect(file?.checks.map((item) => [item.code, item.severity])).toEqual([['SOURCE_DISCREPANCY', 'WARNING']]);
    expect(file?.audit?.mismatches).toEqual([]);
  });

  it('a hand entry stays editable, by revision, until upload', async () => {
    const set = new RinseSet({ name: 'Edit', companyType: 'MULTIFAMILY', currency: 'USD', preparer: PREPARER, converter: new LinesConverter(), newId: ids });
    const first = await set.enterByHand('DEBT_SCHEDULE', [{ lender: 'Aire Valley Bank (synthetic)', facility: 'Mortgage', principal: '14,200,000', rate: '5.25', maturesOn: '2031-06-30' }]);
    const second = await set.enterByHand('DEBT_SCHEDULE', [{ lender: 'Aire Valley Bank (synthetic)', facility: 'Mortgage', principal: '14,150,000', rate: '5.25', maturesOn: '2031-06-30' }], first.id ?? undefined);
    expect(second.id).toBe(first.id);
    expect(set.view().handEntries).toEqual([{ id: first.id, form: 'DEBT_SCHEDULE', revision: 2 }]);
    expect((await set.enterByHand('DEBT_SCHEDULE', [{ lender: 'X' }])).problems.length).toBeGreaterThan(0);
  });
});

describe('offline', () => {
  it('deterministic checks and conversion complete with the network off; AI steps queue on disk and run on reconnect', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rinse-queue-'));
    temporary.push(folder);
    const queuePath = join(folder, 'ai-queue.json');
    const set = await newSet({ queue: await AiQueue.open(queuePath) });
    await set.rinse({ online: false, ai: OFFLINE_AI });
    const offline = set.view();
    expect(fileBy(set, 'Financials/Income statement FY2026.docx').audit?.figuresMatched).toBe(3);
    expect(codes(set, 'Leases/Retail unit lease.pdf')).toContain('CORRUPT');
    expect(codes(set, 'Financials/Copy of Income statement FY2026.docx')).toContain('EXACT_DUPLICATE');
    expect(codes(set, 'Financials/Balance sheet Sept 2026.docx')).toContain('AI_QUEUED');
    expect(codes(set, 'Scans/Operating statement FY2026.pdf')).toContain('NEEDS_VISION');
    expect(offline.aiWaiting).toBeGreaterThan(0);

    // The app restarts: the queue is still on disk.
    const reopened = await AiQueue.open(queuePath);
    expect(reopened.pending().map((job) => job.kind)).toEqual(expect.arrayContaining(['CLASSIFY', 'VISION']));

    const ai = scriptedAi();
    await set.rinse({ online: true, ai });
    expect(set.view().aiWaiting).toBe(0);
    expect(fileBy(set, 'Financials/Balance sheet Sept 2026.docx').category).toBe('BALANCE_SHEET');
    expect(fileBy(set, 'Scans/Operating statement FY2026.pdf').audit?.mismatches.length).toBeGreaterThan(0);
    // Results are cached: rinsing again costs no AI call.
    const before = ai.calls;
    await set.rinse({ online: true, ai });
    expect(ai.calls).toBe(before);
  });

  it('the bundled office converter fails closed when its tool is missing', async () => {
    await expect(new LocalToolConverter('/nonexistent/soffice').convert('a.docx', docx(['x']))).rejects.toEqual(new ConversionError('TOOL_MISSING'));
  });
});

describe('the manifest is untrusted on the pact side', () => {
  it('refuses a tampered manifest', () => {
    expect(parseRinseManifest(new TextEncoder().encode('[]')).problem).toBe('INVALID');
  });
});

describe('bundled converters (T-178b)', () => {
  it('finds LibreOffice and Tesseract under the app’s resources on every platform', () => {
    expect(bundledTools('/R', 'darwin').soffice).toBe('/R/vendor/libreoffice/LibreOffice.app/Contents/MacOS/soffice');
    expect(bundledTools('C:/R', 'win32')).toMatchObject({ soffice: 'C:/R/vendor/libreoffice/program/soffice.exe', tesseract: 'C:/R/vendor/tesseract/bin/tesseract.exe' });
    expect(bundledTools('/R', 'linux').tessdata).toBe('/R/vendor/tesseract/tessdata');
  });
});
