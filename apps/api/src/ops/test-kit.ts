import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { syntheticDocx, syntheticPdf } from '../documents/synthetic-files';

/**
 * Build the FreshCo test kit: editable synthetic sources in
 * fixtures/test-kit/FreshCo → files a person uploads into a fresh deal.
 *
 *   subscriptions.csv  → generated/stripe-invoice-lines.csv (one line per customer per month)
 *   documents/*.md     → generated/*.pdf (pages split on `---page---`), *.docx and *.txt
 *
 * Synthetic data only. Amounts are copied as decimal strings — no arithmetic.
 * Usage: pnpm kit:build [kitDir] [asOfMonth=2026-09]
 */
const kit = resolve(process.argv[2] ?? join(import.meta.dirname, '../../../../fixtures/test-kit/FreshCo'));
const asOf = process.argv[3] ?? '2026-09';
const out = join(kit, 'generated');
mkdirSync(out, { recursive: true });

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const nextMonth = (month: string) => {
  const [year = 0, m = 0] = month.split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
};
const csvField = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

function parseCsv(text: string): Record<string, string>[] {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const keys = (header ?? '').split(',').map((key) => key.trim());
  return rows
    .filter((row) => row.trim() !== '')
    .map((row) => Object.fromEntries(row.split(',').map((value, index) => [keys[index] ?? `col${index}`, value.trim()])));
}

// --- Billing: subscriptions → monthly Stripe-style invoice lines ---
const subscriptions = parseCsv(readFileSync(join(kit, 'subscriptions.csv'), 'utf8'));
const columns = ['line_id', 'invoice_id', 'customer_id', 'customer_name', 'subscription_id', 'price_id', 'currency', 'amount', 'interval', 'interval_count', 'period_start', 'period_end', 'invoice_status', 'created'];
const lines: string[] = [columns.join(',')];
let sequence = 0;
subscriptions.forEach((row, index) => {
  const where = `subscriptions.csv row ${index + 2} (${row['customer_id'] ?? '?'})`;
  const start = row['start_month'] ?? '';
  const end = row['end_month'] || null;
  const change = row['change_month'] || null;
  const amount = row['monthly_amount'] ?? '';
  const changed = row['changed_monthly_amount'] || null;
  if (!MONTH.test(start) || (end && !MONTH.test(end)) || (change && !MONTH.test(change))) throw new Error(`${where}: months must be YYYY-MM`);
  if (!AMOUNT.test(amount) || (changed && !AMOUNT.test(changed))) throw new Error(`${where}: amounts must be like 2400.00`);
  if ((change === null) !== (changed === null)) throw new Error(`${where}: give both change_month and changed_monthly_amount, or neither`);
  const customer = row['customer_id'] ?? '';
  const plan = (row['plan'] ?? 'plan').toLowerCase().replaceAll(/[^a-z0-9]+/g, '_');
  // end_month is the last billed month; months after it are churned.
  for (let month = start; month <= asOf && (!end || month <= end); month = nextMonth(month)) {
    sequence += 1;
    const monthly = change && changed && month >= change ? changed : amount;
    lines.push(
      [
        `il_fc_${String(sequence).padStart(5, '0')}`,
        `in_fc_${month.replace('-', '')}_${customer.slice(-4)}`,
        customer,
        row['customer_name'] ?? customer,
        `sub_${customer}`,
        `price_fc_${plan}_m`,
        row['currency'] || 'USD',
        monthly,
        'month',
        '1',
        `${month}-01`,
        `${nextMonth(month)}-01`,
        'paid',
        `${month}-01`,
      ]
        .map(csvField)
        .join(','),
    );
  }
});
writeFileSync(join(out, 'stripe-invoice-lines.csv'), `${lines.join('\n')}\n`);
process.stdout.write(`billing: ${lines.length - 1} invoice lines for ${subscriptions.length} customers through ${asOf}\n`);

// --- Documents: markdown → PDF (real pages), Word and plain text ---
const wrap = (text: string, width = 92) => {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + word).trim().length > width) {
        out.push(line);
        line = word;
      } else line = `${line} ${word}`.trim();
    }
    out.push(line);
  }
  return out;
};
for (const file of readdirSync(join(kit, 'documents')).filter((name) => name.endsWith('.md')).sort()) {
  const source = readFileSync(join(kit, 'documents', file), 'utf8');
  const pages = source.split(/^---page---$/m).map((page) => page.trim());
  const name = basename(file, '.md');
  writeFileSync(join(out, `${name}.pdf`), syntheticPdf(pages.map((page) => wrap(page))));
  writeFileSync(join(out, `${name}.docx`), syntheticDocx(pages.join('\n\n').split(/\n\s*\n/).map((paragraph) => paragraph.replaceAll('\n', ' '))));
  writeFileSync(join(out, `${name}.txt`), pages.join('\f\n'));
  process.stdout.write(`document: ${name} → .pdf (${pages.length} pages), .docx, .txt\n`);
}
