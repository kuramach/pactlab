import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import type { ConnectionScope } from '../contract';
import { checkAdapterContract } from '../testing';
import { stripeConnectionConfigSchema } from './config';
import { StripeFixtureAdapter } from './fixture.adapter';
import { INVOICE_LINE_EVIDENCE_TYPE, invoiceLineMapping, parseInvoiceLine } from './invoice-line';
import { StripeLiveAdapter } from './live.adapter';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/synthetic');
const COMPANIES = ['HealthyCo', 'TroubledCo', 'SparseCo'] as const;

async function load(dataset: string): Promise<string> {
  const path = resolve(FIXTURES, dataset);
  if (!path.startsWith(FIXTURES + sep)) throw new Error('Unknown synthetic dataset');
  return readFile(path, 'utf8');
}

const scope: ConnectionScope = {
  organizationId: newId(),
  dealId: newId(),
  connectionId: newId(),
  credentialRef: null,
};

describe('Stripe fixture adapter', () => {
  it.each(COMPANIES)('satisfies the connector contract for %s', async (company) => {
    const adapter = new StripeFixtureAdapter({
      datasets: [`${company}/stripe-invoice-lines.csv`],
      load,
    });
    await expect(checkAdapterContract(adapter, scope)).resolves.toEqual([]);
    await expect(adapter.validateConnection(scope)).resolves.toMatchObject({ ok: true });
  });

  it('fails validation for unreadable or unmapped datasets', async () => {
    const missing = new StripeFixtureAdapter({ datasets: ['../../etc/passwd'], load });
    expect((await missing.validateConnection(scope)).ok).toBe(false);
    const wrong = new StripeFixtureAdapter({ datasets: ['HealthyCo/customers.csv'], load });
    const result = await wrong.validateConnection(scope);
    expect(result.checks.find((check) => check.name === 'mappings')?.status).toBe('FAIL');
  });

  it('dry-runs a bounded sample without verbatim source text', async () => {
    const adapter = new StripeFixtureAdapter({
      datasets: ['SparseCo/stripe-invoice-lines.csv'],
      load,
    });
    const { sample, truncated } = await adapter.dryRun(scope, { limit: 5 });
    expect(sample).toHaveLength(5);
    expect(truncated).toBe(true);
    expect(sample[0]).not.toHaveProperty('quote');
    expect(sample[0]?.evidenceType).toBe(INVOICE_LINE_EVIDENCE_TYPE);
    expect(sample[0]?.sourceSystem).toBe('stripe');
  });

  it('matches the invoice-line mapping each synthetic manifest declares', async () => {
    for (const company of COMPANIES) {
      const manifest = JSON.parse(await load(`${company}/manifest.json`)) as {
        datasets: { dataset: string }[];
      };
      const declared = manifest.datasets.find((d) =>
        d.dataset.endsWith('stripe-invoice-lines.csv'),
      );
      expect(declared).toEqual(invoiceLineMapping(`${company}/stripe-invoice-lines.csv`));
    }
  });
});

describe('Stripe live adapter', () => {
  it('is configuration-only: contract-conforming, never reachable, never pulls', async () => {
    const adapter = new StripeLiveAdapter();
    await expect(checkAdapterContract(adapter, scope)).resolves.toEqual([]);
    const result = await adapter.validateConnection(scope);
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'credentials')?.status).toBe('FAIL');
    const withRef = await adapter.validateConnection({ ...scope, credentialRef: 'secret-ref:1' });
    expect(withRef.checks.find((check) => check.name === 'credentials')?.status).toBe('SKIPPED');
    expect((await adapter.dryRun(scope, { limit: 10 })).sample).toEqual([]);
  });

  it('rejects secrets or unknown fields in connection config', () => {
    expect(stripeConnectionConfigSchema.safeParse({ apiKey: 'sk_test_x' }).success).toBe(false);
    expect(stripeConnectionConfigSchema.parse({})).toEqual({ datasets: [] });
  });
});

describe('parseInvoiceLine', () => {
  it('keeps money as strings and missing values as null', () => {
    const line = parseInvoiceLine({
      line_id: 'il_1',
      currency: 'gbp',
      amount: '1500.00',
      interval: 'Month',
      period_start: '2026-09-01',
      period_end: null,
      invoice_status: 'PAID',
    });
    expect(line).toMatchObject({
      lineId: 'il_1',
      currency: 'GBP',
      amount: '1500.00',
      interval: 'month',
      periodStart: '2026-09-01',
      periodEnd: null,
      status: 'paid',
      customerId: null,
    });
    expect(parseInvoiceLine({ amount: '1.00' })).toBeNull();
  });
});
