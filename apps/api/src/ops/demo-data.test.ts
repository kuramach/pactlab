import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BILLING_TEMPLATES, INVOICE_LINE_COLUMNS } from '@pactlab/connectors';
import { isoCurrencySchema } from '@pactlab/contracts';
import { applyMapping, BILLING_INVOICE_LINE, COMPANY_TYPE_LABELS, detectDateFormat, IMPORT_TARGET_DEFINITIONS, PACK_IDS, PACKS, parseCsv, peopleColumnProblems, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { offerSchema } from '../sale/sale.schemas';
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
        // The README sends the reader to the pack's own import by the label Pactlab shows, with the row count the Import button will read.
        if (definition?.built) {
          const readme = read(join(dir, 'README.md'));
          expect(readme, where).toContain(`| **Upload ${targetDefinition.label.toLowerCase()}** | \`${targetDefinition.fileName}\` | `);
          expect(readme, where).toContain(`\`${targetDefinition.fileName}\` | **Upload and map columns** → **Check every row** | **Import ${csv.rows.length} rows** |`);
          expect(readme, where).toMatch(new RegExp(`\\| \`${targetDefinition.fileName.replaceAll('.', '\\.')}\` \\| .* \\| \\*\\*Yes\\*\\* — industry data step \\|`));
        }
      }
    }
  });

  it('every README has both flows, and bidders.csv holds offers the bid API accepts (T-097)', () => {
    for (const { pack, currency, dir } of folders) {
      const where = `${pack}/${currency}`;
      const readme = read(join(dir, 'README.md'));
      expect(readme, where).toContain('# Part A — Buyer side');
      expect(readme, where).toMatch(/# Part B — Seller side: run a (bid process|round)/);
      // Labels exactly as the wizard and the Bidders and Your bid pages show them.
      for (const label of ['**We are selling (or raising)**', '**Add bidder**', '**I accept the NDA**', '**All bidders (without naming who asked)**', '**Start round 2 with 2 shortlisted**', '**Pass on this pact**']) {
        expect(readme, `${where}: ${label}`).toContain(label);
      }
      const table = parseCsv(read(join(dir, 'bidders.csv')));
      const csv = { rows: table.rows.map((row) => Object.fromEntries(table.header.map((column, i) => [column, row.cells[i] ?? ''])) as Record<string, string>) };
      expect(csv.rows, where).toHaveLength(3);
      const offers = csv.rows.filter((row) => row['offer_round_1']);
      expect(offers, where).toHaveLength(2);
      for (const row of offers) {
        for (const column of ['offer_round_1', 'offer_round_2']) {
          expect(offerSchema.safeParse({ price: row[column], currency, structure: row['structure'], conditions: row['conditions'] }).success, `${where} ${row['firm']} ${column}`).toBe(true);
        }
        expect(readme, where).toContain(`\`+${row['invite_tag']}\``);
      }
      expect(csv.rows.some((row) => row['outcome']?.startsWith('Passes')), where).toBe(true);
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

  it('every README is a click-by-click guide that matches what Pactlab shows', () => {
    for (const { pack, currency, dir } of folders) {
      const where = `${pack}/${currency}`;
      const readme = read(join(dir, 'README.md'));
      const definition = PACK_IDS.map((id) => PACKS[id]).find((entry) => entry.slug === pack);
      const label = COMPANY_TYPE_LABELS[definition?.id ?? 'OTHER'];
      expect(readme, where).toContain('Synthetic demo data');
      expect(readme, where).toContain(`Base currency: **${currency}**`);
      // Labels exactly as the wizard and the Findings tab show them.
      expect(readme, where).toContain(`What kind of company is it?: **${label}**`);
      expect(readme, where).toContain(`**Run ${label.toLowerCase()} checks**`);
      // Steps are numbered 1..n.
      const steps = readme.match(/^## Step (\d+) — /gm)?.map((line) => Number(/\d+/.exec(line)?.[0])) ?? [];
      expect(steps.length, where).toBeGreaterThanOrEqual(5);
      expect(steps, where).toEqual(Array.from({ length: steps.length }, (_, i) => i + 1));
      // The price to test: an asking price in the wizard, or the founder's round for a raise.
      if (pack === 'venture-raise') expect(readme, where).toMatch(/\| Your ask \(pre-money\) \| `[1-9]\d+` /);
      else expect(readme, where).toMatch(new RegExp(`\\| Asking price \\| \`[1-9]\\d+\` \\(${currency} [\\d,]+\\) \\|`));
      // The billing Import button's line count.
      expect(readme, where).toContain(`**Import ${parseCsv(read(join(dir, 'invoice-lines.csv'))).rows.length} lines**`);
      // Every PDF is listed for upload with a data class the Documents tab offers; .md sources never are.
      const pdfs = readdirSync(join(dir, 'documents')).filter((name) => name.endsWith('.md')).map((name) => name.replace(/\.md$/, '.pdf'));
      for (const pdf of pdfs) {
        expect(readme, `${where}: ${pdf}`).toMatch(new RegExp(`\\| \\d+ \\| \`documents/${pdf.replaceAll('.', '\\.')}\` \\| \\*\\*(business|financial) information\\*\\* \\|`));
      }
      expect(readme, where).toContain(`all ${pdfs.length} documents listed`);
      expect(readme, where).toContain('| `documents/*.md` | The text each PDF is built from | **No** — never |');
      // The planted findings: at least three, and the count the README promises.
      const promised = Number(/You should see exactly these (\d+) findings/.exec(readme)?.[1]);
      const listed = readme.split('You should see exactly these')[1]?.split('\n3. ')[0]?.match(/^ {3}\d+\. \*\*/gm)?.length ?? 0;
      expect(listed, where).toBe(promised);
      expect(listed, where).toBeGreaterThanOrEqual(3);
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
