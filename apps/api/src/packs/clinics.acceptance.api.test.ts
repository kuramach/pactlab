import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, type AcceptanceDeal, acceptAndValue, type Body, HISTORY_YEARS as YEARS, type PackMetricsBody, pdfOf, startAcceptanceDeal } from './acceptance-kit';

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

/** Line kinds a person confirms for the demo P&L: revenue lines, "cost of" lines, the rest operating costs. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : /^cost of/i.test(account) ? 'COGS' : 'OPEX');

/**
 * T-068 and T-161 acceptance: pactlab-demo-data/small-clinics/<CURRENCY> loaded into a fresh deal through
 * the real APIs — billing, the T-068 extracts, the healthcare evidence set reused as it is (remittances,
 * collections by clinician, the credentialing and payer contract registers), the service lines, the
 * referrals, the five-year P&L and every document — surfaces the T-068 three and the planted (a) 58% of
 * visits from one referral source, (b) a lease ending 14 months after closing with no renewal option,
 * (c) the selling owner as the only provider of the highest-margin service line and (d) supplies
 * outpacing revenue across five years, as cited drafts; the reviewer-priced replacement reaches a DCF
 * run; the Clinic and Practice views are the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('small clinics pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('SMALL_CLINICS', currency);
    // An HR file naming another provider as the owner, with a succession plan, must never be read by a rule (rule 7).
    const hr = await deal.call('POST', `/v1/deals/${deal.dealId}/documents`, 'lead', {
      fileName: 'hr-notes.pdf',
      contentType: 'application/pdf',
      contentBase64: pdfOf('P02 is the selling owner. P02 has agreed a twelve-month transition period after closing.').toString('base64'),
      dataClass: 'HR',
    });
    expect(hr.status).toBe(201);
    // The P&L by year (FY2021–FY2025, T-184b), years across the columns, line kinds confirmed by a person.
    const csv = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl.csv`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    pnlUploadId = uploaded.body['id'] as string;
    const accounts = csv.trim().split('\n').slice(1).map((row) => row.split(',')[0] ?? '');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/import`, 'lead', { mapping });
    expect(imported.body, JSON.stringify(imported.body)).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: accounts.length * 5 } });
  }, 180_000);
  afterAll(async () => deal?.close());

  it('every planted finding surfaces as a cited draft; a re-run adds nothing', async () => {
    const run = await runRules();
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'SMALL_CLINICS', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(10);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-068, unchanged. The README's figures for this folder: "P07 earns 73.8% of Site 3 revenue".
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

    // (a) 58% of visits from one referral source, recomputed from the referral export.
    const referral = byTitle['58.0% of visits come from one referral source: Harbourside Hospital orthopaedics (synthetic)'];
    expect(referral).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(referral?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);

    // (b) The lease ends 14 months after the stated closing with no renewal option; consent to assign is a closing condition.
    const lease = byTitle['Clinic lease ends 14 months after closing, with no renewal option'];
    expect(lease).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: null });
    expect(lease?.evidence.map((link) => link.documentCitation?.quote)).toEqual(expect.arrayContaining(['The term began on 1 February 2018 and ends on 31 January 2028.', 'There is no option to renew or extend the term.']));
    expect(lease?.description).toContain('14 whole months after the expected closing on 2026-11-30');
    expect(byTitle['Clinic lease: assignment on a sale needs the landlord’s consent']).toMatchObject({ domain: 'PROPERTY', direction: 0 });

    // (c) The selling owner is the only provider of the highest-margin service line; the HR look-alike was never read.
    const owner = byTitle['The selling owner is the only provider of the highest-margin service line: Implants'];
    expect(owner).toMatchObject({ domain: 'PEOPLE', direction: -1, pricedRisk: null });
    expect(owner?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe('P01 is the selling owner and principal dentist, and performs every implant procedure.');
    expect(owner?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);
    expect(Object.keys(byTitle).some((title) => title.includes('P02'))).toBe(false);

    // (d) Supplies outpacing revenue, which one year alone misses, cited to the five imported rows.
    const supplies = byTitle['Clinical and dental supplies growing faster than revenue, 2021–2025'];
    expect(supplies).toMatchObject({ direction: -1 });
    expect(supplies?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(5);
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });
    // The clinic's visits hold steady across the five years: no visits trend is drafted (T-184b).
    expect(Object.keys(byTitle).some((title) => title.startsWith('Visits falling'))).toBe(false);

    // The healthcare checks, reused by id, ran too: the deck's days in AR is verified against the remittances.
    expect(byTitle['Claim verified: Days in accounts receivable']?.direction).toBe(1);
  });

  it('the Clinic view reads the owner, the service lines, the referrals and the lease; the Practice view is the healthcare one, reused', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/clinics`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & {
      owner: { providerRef: string; share: { source: string; collectionShare: string }; succession: { inPlace: boolean } };
      serviceLines: { lines: { serviceLine: string; ownerOnly: boolean; margin: string }[] };
      referrals: { sources: { source: string; share: string; selfReferral: boolean }[] };
      premises: { measuredFrom: { date: string; basis: string }; leases: { expiresOn: string; monthsRemaining: number; renewal: string; assignment: string }[] };
    };
    expect(body).toMatchObject({ version: 'clinics-practice-1', currency, analysisDate: '2026-09-30', canRunChecks: true });
    expect(body.owner).toMatchObject({ providerRef: 'P01', share: { source: 'SERVICE_LINES' }, succession: { inPlace: false } });
    expect(body.serviceLines.lines[0]).toMatchObject({ serviceLine: 'Implants', ownerOnly: true });
    expect(body.serviceLines.lines.filter((line) => line.ownerOnly).map((line) => line.serviceLine)).toEqual(['Implants']);
    expect(body.referrals.sources[0]?.source).toBe('Harbourside Hospital orthopaedics (synthetic)');
    expect(body.referrals.sources.find((entry) => entry.source === 'Self-referral')?.selfReferral).toBe(true);
    expect(body.premises.measuredFrom).toMatchObject({ date: '2026-11-30', basis: 'EXPECTED_CLOSING' });
    expect(body.premises.leases).toMatchObject([{ expiresOn: '2028-01-31', monthsRemaining: 14, renewal: 'NONE', assignment: 'CONSENT' }]);

    const practice = (await deal.call('GET', `/v1/deals/${deal.dealId}/healthcare`, 'lead')).body as { version: string; trend: { years: { year: string; ratios: { key: string }[] }[] }; credentials: { exceptions: unknown[] } };
    expect(practice.version).toBe('healthcare-collections-1');
    expect(practice.credentials.exceptions).toEqual([]);
    expect(practice.trend.years.map((year) => year.year)).toEqual([...YEARS]);
    expect(practice.trend.years[0]?.ratios.map((ratio) => ratio.key)).toEqual(['supplies', 'lab', 'clinical', 'occupancy']);
    // The pack's own figures on Finances: the healthcare ones, then the clinic's.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('clinics-practice');
    // Five years side by side (T-184b): the healthcare drivers with the clinic's key expenses.
    expect(metrics.history?.years).toEqual(YEARS.map((year) => `FY${year}`));
    expect(metrics.history?.rows.map((row) => row.key)).toEqual(expect.arrayContaining(['visits', 'commercial_share', 'denial_rate', 'expense_supplies']));
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 years; earlier years not provided)', 'FY2021–FY2025 (5 years; earlier years not provided)']);
    expect(Number(metrics.metrics.find((metric) => metric.key === 'top_referral_share')?.value)).toBeCloseTo(Number(body.referrals.sources[0]?.share), 3);
    expect(metrics.metrics.find((metric) => metric.key === 'collected')?.value).not.toBeNull();
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/clinics`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/clinics`, 'other')).status).toBe(404);
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

  it('a withdrawn P&L leaves the trend; a single-year re-import reads one year', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/healthcare`, 'lead')).body as { trend: { years: unknown[] } };
    expect(after.trend.years).toEqual([]);
    const single = 'Line,FY2025\nNet patient service revenue,100000.00\nClinical and dental supplies,10000.00\n';
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl-fy2025.csv`, 'lead', single);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: { 'Net patient service revenue': 'REVENUE', 'Clinical and dental supplies': 'OPEX' } };
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping })).status).toBe(200);
    expect((await runRules()).status).toBe(200);
    const titles = (await findings()).map((finding) => finding.title);
    expect(titles).toContain('P&L for 2025: one year imported');
    expect(titles.filter((title) => title.startsWith('Clinical and dental supplies growing faster'))).toHaveLength(1);
    // Partial history (T-184b): one year of income and expenses states its coverage and asks the seller for the rest.
    const partial = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(partial.history?.coverage.find((entry) => entry.key === 'operating')?.summary).toBe('FY2025 (1 of 5 years): ask the seller for FY2021–FY2024 income statements, or tell us the business started later');
    expect(partial.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2021–FY2024 income statements, or tell us the business started later.' }]);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
