import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BILLING_TEMPLATES, INVOICE_LINE_COLUMNS } from '@pactlab/connectors';
import { isoCurrencySchema } from '@pactlab/contracts';
import { applyMapping, BILLING_INVOICE_LINE, detectDateFormat, IMPORT_TARGET_DEFINITIONS, PACK_IDS, PACKS, parseCsv, peopleColumnProblems, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentPages } from '../documents/document-text';
import { SignatureMalwareScanner, validateUpload } from '../documents/upload-policy';

/**
 * Contract test for the public demo data set (scripts/demo-data, published at
 * kuramach/pactlab-demo-data). It runs the Python generator and checks every
 * file against the code that will ingest it — the billing-import template and
 * mapping, the document upload policy and text extraction, and the site's
 * pack list. A format change in Pactlab that the demo data no longer meets
 * fails here, before customers find out.
 */
const repo = resolve(import.meta.dirname, '../../../..');
const generator = join(repo, 'scripts/demo-data/generate.py');
const CURRENCIES = ['EUR', 'GBP', 'USD'];
let out = '';
let folders: { pack: string; currency: string; dir: string }[] = [];

const read = (path: string) => readFileSync(path, 'utf8');

function standardMapping(header: readonly string[], csv: ReturnType<typeof parseCsv>): ImportMapping {
  const template = BILLING_TEMPLATES.pactlab_standard;
  return {
    target: 'BILLING_INVOICE_LINE',
    fields: suggestFields(BILLING_INVOICE_LINE, header, template.aliases),
    dateFormat: detectDateFormat(csv, 'created') ?? template.defaults.dateFormat ?? 'YYYY-MM-DD',
    numberFormat: template.defaults.numberFormat ?? 'DOT_DECIMAL',
    amountUnit: template.defaults.amountUnit ?? 'MAJOR',
    negateAmounts: false,
  };
}

async function upload(fileName: string, contentType: string, bytes: Buffer) {
  return validateUpload({ fileName, contentType, contentBase64: bytes.toString('base64') }, new SignatureMalwareScanner());
}

beforeAll(() => {
  const python = spawnSync('python3', ['--version']);
  if (python.status !== 0) throw new Error('python3 is required to test scripts/demo-data/generate.py');
  out = mkdtempSync(join(tmpdir(), 'pactlab-demo-data-'));
  const run = spawnSync('python3', [generator, out], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`generate.py failed:\n${run.stderr}`);
  folders = readdirSync(out).flatMap((pack) => readdirSync(join(out, pack)).map((currency) => ({ pack, currency, dir: join(out, pack, currency) })));
}, 60_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe('demo data set (scripts/demo-data/generate.py)', () => {
  it('covers every industry pack on the site, each in USD, EUR and GBP', () => {
    const content = read(join(repo, 'apps/site/lib/content.ts'));
    const industries = content.slice(content.indexOf('export const INDUSTRIES'));
    const slugs = [...industries.matchAll(/^ {4}slug: '([a-z0-9-]+)',$/gm)].map((match) => match[1]);
    expect(slugs.length).toBeGreaterThanOrEqual(12);
    expect(readdirSync(out).sort()).toEqual([...slugs].sort());
    for (const pack of slugs) expect(readdirSync(join(out, pack ?? '')).sort(), pack).toEqual(CURRENCIES);
  });

  it('is deterministic: a second run writes the same files', () => {
    const again = mkdtempSync(join(tmpdir(), 'pactlab-demo-data-'));
    try {
      expect(spawnSync('python3', [generator, again]).status).toBe(0);
      for (const { pack, currency } of folders) {
        for (const file of ['invoice-lines.csv', 'README.md', 'vdr-index.csv']) {
          expect(read(join(again, pack, currency, file)), `${pack}/${currency}/${file}`).toBe(read(join(out, pack, currency, file)));
        }
      }
    } finally {
      rmSync(again, { recursive: true, force: true });
    }
  }, 60_000);

  it('every invoice-lines.csv imports cleanly on the Pactlab standard billing template', () => {
    for (const { pack, currency, dir } of folders) {
      const where = `${pack}/${currency}`;
      const csv = parseCsv(read(join(dir, 'invoice-lines.csv')));
      expect(csv.header, where).toEqual([...INVOICE_LINE_COLUMNS]);
      expect(isoCurrencySchema.safeParse(currency).success, where).toBe(true);
      const result = applyMapping(csv, standardMapping(csv.header, csv), 'billing');
      expect(result.issues, where).toEqual([]);
      expect(result.rows.length, where).toBe(csv.rows.length);
      expect(result.rows.length, where).toBeGreaterThan(0);
      expect(new Set(result.rows.map((row) => row.canonical['currency'])), where).toEqual(new Set([currency]));
    }
  });

  it('every pack extract imports cleanly through its pack target', () => {
    for (const { pack, currency, dir } of folders) {
      const definition = PACK_IDS.map((id) => PACKS[id]).find((entry) => entry.slug === pack);
      expect(definition, pack).toBeDefined();
      for (const target of definition?.importTargets ?? []) {
        if (target === 'BILLING_INVOICE_LINE') continue;
        const targetDefinition = IMPORT_TARGET_DEFINITIONS[target];
        const where = `${pack}/${currency}/${targetDefinition.fileName}`;
        const csv = parseCsv(read(join(dir, targetDefinition.fileName)));
        expect(peopleColumnProblems(targetDefinition, csv.header), where).toEqual([]);
        const mapping: ImportMapping = {
          target,
          fields: suggestFields(targetDefinition, csv.header, {}),
          dateFormat: 'YYYY-MM-DD',
          numberFormat: 'DOT_DECIMAL',
          amountUnit: 'MAJOR',
          negateAmounts: false,
        };
        const result = applyMapping(csv, mapping, 'pack', targetDefinition);
        expect(result.issues, where).toEqual([]);
        expect(result.rows.length, where).toBe(csv.rows.length);
        // The README sends the reader to the pack's own import, by the label Pactlab shows.
        if (definition?.built) expect(read(join(dir, 'README.md')), where).toContain(`| \`${targetDefinition.fileName}\` | `);
        if (definition?.built) expect(read(join(dir, 'README.md')), where).toContain(`Sources → Industry data → **Upload ${targetDefinition.label.toLowerCase()}** |`);
      }
    }
  });

  it('every document is accepted by the upload policy and yields text', async () => {
    for (const { pack, currency, dir } of folders) {
      for (const file of readdirSync(join(dir, 'documents')).filter((name) => name.endsWith('.md'))) {
        const where = `${pack}/${currency}/documents/${file}`;
        const validated = await upload(file, 'text/markdown', readFileSync(join(dir, 'documents', file)));
        const pages = await documentPages(validated);
        expect(pages.some((page) => page.text.trim() !== ''), where).toBe(true);
      }
    }
  });

  it('PDFs built by build.sh pass the upload policy and keep their pages', async () => {
    // build.sh renders PDFs with the FreshCo kit builder; exercise it on one folder.
    const sample = folders.find((folder) => folder.pack === 'multifamily' && folder.currency === 'EUR');
    expect(sample).toBeDefined();
    const kit = mkdtempSync(join(tmpdir(), 'pactlab-demo-kit-'));
    try {
      const docs = join(kit, 'documents');
      mkdirSync(docs, { recursive: true });
      for (const file of readdirSync(join(sample?.dir ?? '', 'documents'))) {
        writeFileSync(join(docs, file), readFileSync(join(sample?.dir ?? '', 'documents', file)));
      }
      writeFileSync(
        join(kit, 'subscriptions.csv'),
        'customer_id,customer_name,plan,currency,monthly_amount,start_month,end_month,change_month,changed_monthly_amount\nx-0001,Placeholder,Plan,USD,1.00,2026-09,,,\n',
      );
      const build = spawnSync('pnpm', ['exec', 'tsx', 'src/ops/test-kit.ts', kit, '2026-09'], { cwd: join(repo, 'apps/api'), encoding: 'utf8' });
      expect(build.status, build.stderr).toBe(0);
      for (const file of readdirSync(docs).filter((name) => name.endsWith('.md'))) {
        const pdf = join(kit, 'generated', file.replace(/\.md$/, '.pdf'));
        expect(existsSync(pdf), pdf).toBe(true);
        const validated = await upload(file.replace(/\.md$/, '.pdf'), 'application/pdf', readFileSync(pdf));
        const pages = await documentPages(validated);
        const expected = read(join(docs, file)).split(/^---page---$/m).length;
        expect(pages.length, file).toBe(expected);
      }
    } finally {
      rmSync(kit, { recursive: true, force: true });
    }
  }, 60_000);

  it('every folder has a README with planted findings, and a data-room index naming real files', () => {
    for (const { pack, currency, dir } of folders) {
      const where = `${pack}/${currency}`;
      const readme = read(join(dir, 'README.md'));
      expect(readme, where).toContain('Synthetic demo data');
      expect(readme, where).toContain(`base currency **${currency}**`);
      expect(readme.split('## Planted findings')[1]?.match(/^\d+\. \*\*/gm)?.length ?? 0, where).toBeGreaterThanOrEqual(3);
      const index = parseCsv(read(join(dir, 'vdr-index.csv')));
      for (const row of index.rows) {
        const file = row.cells[2] ?? '';
        const onDisk = file.endsWith('.pdf') ? file.replace(/\.pdf$/, '.md') : file; // PDFs are built from these sources
        expect(existsSync(join(dir, onDisk)), `${where}: ${file}`).toBe(true);
      }
    }
  });

  it('stays synthetic: no email addresses, credentials or real-looking identifiers', () => {
    for (const { pack, currency, dir } of folders) {
      const files = ['README.md', 'vdr-index.csv', ...readdirSync(dir).filter((name) => name.endsWith('.csv'))];
      const text = files.map((file) => read(join(dir, file))).join('\n') + readdirSync(join(dir, 'documents')).map((file) => read(join(dir, 'documents', file))).join('\n');
      expect(text, `${pack}/${currency}`).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(text, `${pack}/${currency}`).not.toMatch(/password|secret|api[_-]?key|\b\d{3}-\d{2}-\d{4}\b/i);
    }
  });
});
