import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, acceptAndValue, startAcceptanceDeal, type AcceptanceDeal } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  domain: string;
  version: number;
  direction: number | null;
  description: string;
  pricedRisk: { type: string; low: string; high: string; currency: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/**
 * T-068 and T-161 acceptance: pactlab-demo-data/small-clinics/<CURRENCY> loaded into a fresh deal —
 * every extract, the documents and the P&L for three fiscal years — surfaces the seven planted
 * findings as cited drafts: T-068's three, and the few-site variant's four (one referral source,
 * a lease ending 14 months after closing with no renewal option, the selling owner as the only
 * provider of the highest-margin service line, and supply costs outpacing revenue across the
 * years, which no single year shows). The equipment replacement and the lease, priced, reach a DCF run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('small clinics pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUpload = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  const importPnl = async (file: string) => {
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?${new URLSearchParams({ target: 'FINANCIAL_PNL', system: 'pactlab_standard', fileName: file }).toString()}`, 'lead', readFileSync(join(deal.folder, 'pnl.csv'), 'utf8'));
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    // What each line is: a person picks it on screen; the folder's pnl-line-kinds.csv says the same.
    const kinds = parseCsv(readFileSync(join(deal.folder, 'pnl-line-kinds.csv'), 'utf8'));
    const lineKinds = Object.fromEntries(kinds.rows.map((row) => [row.cells[0] ?? '', row.cells[1] ?? '']));
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping: { ...(uploaded.body['suggestedMapping'] as Record<string, unknown>), lineKinds } });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    expect(imported.body['syncRun']).toMatchObject({ status: 'SUCCEEDED', recordsCreated: 18 });
    return uploaded.body['id'] as string;
  };

  beforeAll(async () => {
    deal = await startAcceptanceDeal('SMALL_CLINICS', currency);
    pnlUpload = await importPnl('pnl.csv');
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the seven planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'SMALL_CLINICS', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(7);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 7 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's figures for this folder: "P07 earns 73.8% of Site 3 revenue".
    const [, provider, share, site] = deal.readme.match(/— (P[0-9]+) earns ([0-9.]+%) of (Site [0-9]+) revenue/) ?? [];
    const carries = byTitle[`One provider carries ${site}`];
    expect(carries).toMatchObject({ domain: 'PEOPLE', direction: -1 });
    expect(carries?.description).toContain(`${provider} earns ${share} of ${site} revenue`);
    expect(carries?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);

    const coding = byTitle['High-complexity coding above policy'];
    expect(coding).toMatchObject({ domain: 'REGULATORY', direction: -1 });
    expect(coding?.description).toMatch(/^From 2025-Q4 to 2026-Q3, 31\.0%–36\.0% of visits are coded at the highest complexity against the 15\.0%/);
    expect(coding?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/about 15% of visits/);

    const equipment = byTitle['Imaging equipment past its useful life'];
    expect(equipment).toMatchObject({ domain: 'OPERATIONAL', direction: -1, pricedRisk: null });
    expect(equipment?.evidence).toHaveLength(2);
    expect(equipment?.description).toMatch(/^2 items are in service past their useful life at 2026-09-30: Panoramic X-ray unit at Site 1 \(acquired 2014-05-01/);

    // (a) One referral source sends 58% of visits.
    const referral = byTitle['One referral source sends 58.0% of visits'];
    expect(referral).toMatchObject({ domain: 'COMMERCIAL', direction: 0, severity: 'HIGH' });
    expect(referral?.description).toMatch(/^Harbourside Orthodontic Group \(synthetic\) referred [0-9,]+ of [0-9,]+ visits \(58\.0%\) over the 12 months to September 2026/);
    expect(referral?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);

    // (b) The lease ends 14 months after the target closing date with no renewal option, priced from the stated relocation estimate.
    const lease = byTitle['Clinic lease ends 14 months after closing with no renewal option'];
    expect(lease).toMatchObject({ domain: 'PROPERTY', direction: -1, severity: 'HIGH' });
    const relocation = { USD: '420000', EUR: '386400', GBP: '331800' }[currency];
    expect(lease?.pricedRisk).toMatchObject({ type: 'REMEDIATION_COST', currency, high: relocation });
    expect(lease?.description).toContain('The lease ends on 2028-03-31, 14 months after the target closing date (2027-01-31)');
    const quotes = (lease?.evidence ?? []).map((link) => (link.documentCitation?.quote ?? '').replace(/\s+/g, ' '));
    for (const sentence of ['The term of this lease expires on 31 March 2028.', 'Tenant has no option to renew or extend the term.', 'The target closing date is 31 January 2027.', 'without the landlord’s prior written consent.']) {
      expect(quotes.some((quote) => quote.includes(sentence)), sentence).toBe(true);
    }

    // (c) The selling owner is the only provider of the highest-margin service line, with no succession plan filed.
    const owner = byTitle['Selling owner is the only provider of Implants'];
    expect(owner, owner?.description).toMatchObject({ domain: 'PEOPLE', direction: -1, severity: 'HIGH', pricedRisk: null });
    expect(owner?.description).toContain('No associate or contractor delivered any Implants visit: no associate coverage.');
    expect(owner?.description).toMatch(/Implants is the highest-margin service line in 2026 \(69\.0% margin\)/);
    expect(owner?.description).toContain('No succession or transition plan is among the documents filed.');

    // (d) Supply costs outpacing revenue across three years: a trend no single year shows, citing the P&L rows of every year.
    const trend = byTitle['Clinical supplies outpacing revenue'];
    expect(trend).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(trend?.description).toMatch(/their share of revenue rose 1\.6 points: 2024 [0-9]+ \(9\.0%\), 2025 [0-9]+ \(9\.8%\), 2026 [0-9]+ \(10\.6%\)/);
    expect(trend?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(6);
  });

  it('the pack metrics read the owner, referrals, payer mix, denials, credentials and every P&L year', async () => {
    const report = await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead');
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body).toMatchObject({ calculator: 'clinics-metrics', version: 'clinics-metrics-1', currency });
    const value = (key: string) => (report.body['metrics'] as { key: string; value: string | null }[]).find((metric) => metric.key === key)?.value;
    expect(value('top_referral_share')).toBe('0.5800');
    expect(value('owner_only_service_lines')).toBe('1');
    expect(value('pnl_years')).toBe('3');
    expect(value('supplies_ratio_2024')).toBe('0.0900');
    expect(value('supplies_ratio_2026')).toBe('0.1059');
    expect(value('credentials_lapsing')).toBe('0');
    expect(Number(value('denial_rate'))).toBeGreaterThan(0);
  });

  it('the reviewer prices the replacements as remediation; accepted, they reach a DCF run', async () => {
    const equipment = (await findings()).find((finding) => finding.title === 'Imaging equipment past its useful life');
    const lines = await acceptAndValue(deal, { id: equipment?.id ?? '', version: equipment?.version ?? 1 }, {
      pricedRisk: { type: 'REMEDIATION_COST', currency, low: '180000.00', high: '240000.00', basis: 'Two replacement quotes (synthetic).' },
      assumptions: {
        method: 'DCF',
        baseRevenue: '2800000',
        years: [1, 2, 3, 4, 5].map(() => ({ growth: '0.05', fcfMargin: '0.18' })),
        discountRate: '0.12',
        terminal: { kind: 'GORDON', growth: '0.02' },
      },
    });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: equipment?.id, amount: { amount: '-180000.00' } });
  });

  it('a withdrawn P&L stops counting: the trend reads only active imports (T-154)', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUpload}/withdraw`, 'lead', { reason: 'Wrong statement sent (synthetic).' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const report = await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead');
    expect((report.body['metrics'] as { key: string; value: string | null; needs?: string[] }[]).find((metric) => metric.key === 'pnl_years')).toMatchObject({ value: null, needs: ['FINANCIAL_PNL'] });
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 6 });
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
