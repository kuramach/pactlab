import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, acceptAndValue, pdfOf, startAcceptanceDeal, type AcceptanceDeal, type Body } from './acceptance-kit';

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
 * T-069 and T-162 acceptance: pactlab-demo-data/hospitals/<CURRENCY> loaded into a fresh deal through the
 * real APIs — billing, the census, the payer mix, the medical-staff register, the three-year P&L and every
 * document — surfaces the T-069 four and the planted (a) the largest payer contract ending seven months
 * after closing, (b) the cost report's occupancy contradicting the deck, (c) capital spend falling across
 * the three P&L years against a "modern plant" claim and (d) one department's privileges lapsed together,
 * as cited drafts; the committed regulatory capex comes off the price in a payer-mix-adjusted EBITDA run;
 * the Hospital view is the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('hospitals pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('HOSPITALS', currency);
    // An HR file restating occupancy and a lapsed licence must never be read by a rule (rule 7).
    const hr = await deal.call('POST', `/v1/deals/${deal.dealId}/documents`, 'lead', {
      fileName: 'hr-notes.pdf',
      contentType: 'application/pdf',
      contentBase64: pdfOf('Medical staff notes (synthetic). Occupancy averaged 99% of licensed beds in fiscal year 2025. MS-001: medical licence — expired on 1 January 2026.').toString('base64'),
      dataClass: 'HR',
    });
    expect(hr.status).toBe(201);
    // The P&L by year (FY2023–FY2025), years across the columns, line kinds confirmed by a person.
    const csv = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl.csv`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    pnlUploadId = uploaded.body['id'] as string;
    const accounts = csv.trim().split('\n').slice(1).map((row) => row.split(',')[0] ?? '');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/import`, 'lead', { mapping });
    expect(imported.body, JSON.stringify(imported.body)).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: accounts.length * 3 } });
  }, 180_000);
  afterAll(async () => deal?.close());

  it('every planted finding surfaces as a cited draft; a re-run adds nothing', async () => {
    const run = await runRules();
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'HOSPITALS', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(11);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: 11 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README lists every finding the folder plants, and nothing else is drafted.
    const listed = [...deal.readme.matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1] ?? '');
    expect(listed.map((title) => (title === 'Key-physician dependence in cardiology' ? 'Key-physician dependence' : title)).sort()).toEqual(Object.keys(byTitle).sort());

    // T-069, unchanged. The README's figures for this folder.
    const [, payer, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of September 2026 net revenue/) ?? [];
    const concentration = byTitle['Earnings concentrated in one payer'];
    expect(concentration).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(concentration?.description).toContain(`${payer} is ${share} of September 2026 net revenue`);
    const accreditation = byTitle['Accreditation does not transfer automatically'];
    expect(accreditation).toMatchObject({ domain: 'REGULATORY', direction: 0 });
    expect(accreditation?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/does not transfer automatically/) });
    const physicians = byTitle['Key-physician dependence'];
    expect(physicians).toMatchObject({ domain: 'PEOPLE', direction: -1, pricedRisk: null });
    expect(physicians?.evidence[0]?.documentCitation?.quote).toMatch(/two interventional cardiologists perform about 80% of procedures/);
    const [, capexCurrency, capex] = deal.readme.match(/— ([A-Z]{3}) ([0-9,]+) committed/) ?? [];
    expect(byTitle['Committed regulatory capex']).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: capexCurrency, high: (capex ?? '').replaceAll(',', '') } });

    // (a) The largest contracted payer's agreement ends seven months after the stated closing.
    const contract = byTitle['Largest payer contract ends 7 months after closing: Commercial plan Keystone (synthetic)'];
    expect(contract).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(contract?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);
    expect(contract?.evidence.map((link) => link.documentCitation?.quote)).toEqual(
      expect.arrayContaining(['The term began on 1 August 2022 and ends on 31 July 2027.', 'The parties have agreed a target closing date of 31 December 2026.']),
    );

    // (b) The deck's occupancy contradicted by the filed cost report; the Medicare share verified. The HR look-alike was never read.
    const occupancy = byTitle['The cost report contradicts the deck: Occupancy of licensed beds'];
    expect(occupancy).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(occupancy?.description).toContain('66.4%');
    expect(occupancy?.description).not.toContain('99%');
    expect(occupancy?.evidence.map((link) => link.documentCitation?.quote)).toEqual(expect.arrayContaining(['Occupancy averaged 82% of licensed beds in fiscal year 2025.', 'Occupancy of licensed beds: 66.4%.']));
    expect(byTitle['Claim verified against the cost report: Medicare share of inpatient days']?.direction).toBe(1);

    // (c) Capital spend falling across three P&L years against the deck's modern-plant claim, priced at the stated deferred maintenance.
    const plant = byTitle['Capital spend fell from 6.1% to 2.6% of revenue, 2023–2025, against a “modern plant” claim'];
    expect(plant).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency } });
    expect(plant?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(3);
    expect(plant?.evidence.map((link) => link.documentCitation?.quote)).toEqual(expect.arrayContaining(['The hospital runs a modern plant, with the main building fully renovated in 2016.']));

    // (d) One department's privileges lapsed together, cited to the seven register rows.
    const staff = byTitle['Orthopaedics: clinical privileges lapsed together for 7 medical staff on 2026-06-30'];
    expect(staff).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: null });
    expect(staff?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(7);
    expect(Object.keys(byTitle).some((title) => /licence/i.test(title))).toBe(false);

    // Quality claims map to the reporting supplied; the P&L trend is a record.
    expect(byTitle['Quality claim verified: overall star rating']?.direction).toBe(1);
    expect(byTitle['P&L trend, 2023–2025']).toMatchObject({ direction: 0 });

    // Claims settled by rules land in the claims register.
    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims?limit=100`, 'lead')).body['items'] as { statement: string; status: string }[];
    expect(claims.map((claim) => [claim.statement, claim.status])).toEqual(
      expect.arrayContaining([
        ['Occupancy averaged 82% of licensed beds in fiscal year 2025.', 'CONTRADICTED'],
        ['Medicare accounts for 41% of inpatient days.', 'VERIFIED'],
        ['The hospital holds a four-star overall rating from the national hospital quality rating programme (synthetic).', 'VERIFIED'],
      ]),
    );
  });

  it('the Hospital view reads the cost report, the contracts, the staff, the plant and quality; the calculator its figures', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/hospitals`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & {
      costReport: { reports: { fiscalYear: string; beds: { value: string } }[]; claims: { status: string }[]; reconciliation: { fiscalYear: string; agrees: boolean }[] };
      payerContracts: { measuredFrom: { date: string; basis: string }; payers: { payer: string; state: string; monthsAfterClose: number | null; largestContracted: boolean }[] };
      medicalStaff: { count: number; clusters: { department: string; state: string; staff: string[] }[]; exceptionCount: number };
      plant: { years: { year: string; ratio: string }[]; claim: { quote: string } | null; assessments: { deferredMaintenance: { amount: string } | null }[] };
      quality: { reports: { stars: number }[]; claims: { status: string }[] };
      trend: { years: { year: string; ratios: { key: string }[] }[] };
    };
    expect(body).toMatchObject({ version: 'hospitals-operations-1', currency, analysisDate: '2026-09-30', canRunChecks: true });
    expect(body.costReport.reports).toMatchObject([{ fiscalYear: '2025', beds: { value: '220' } }]);
    expect(body.costReport.claims.map((claim) => claim.status)).toEqual(['CONTRADICTED', 'VERIFIED']);
    expect(body.costReport.reconciliation).toMatchObject([{ fiscalYear: '2025', agrees: true }]);
    expect(body.payerContracts.measuredFrom).toMatchObject({ date: '2026-12-31', basis: 'EXPECTED_CLOSING' });
    expect(body.payerContracts.payers.find((entry) => entry.largestContracted)).toMatchObject({ payer: 'Commercial plan Keystone (synthetic)', state: 'EXPIRES_WITHIN_YEAR', monthsAfterClose: 7 });
    expect(body.payerContracts.payers.find((entry) => entry.payer === 'Commercial plan Riverbend (synthetic)')?.state).toBe('RENEWS');
    expect(body.medicalStaff).toMatchObject({ count: 55, exceptionCount: 7 });
    expect(body.medicalStaff.clusters).toMatchObject([{ department: 'Orthopaedics', state: 'LAPSED' }]);
    expect(body.plant.years.map((year) => year.year)).toEqual(['2023', '2024', '2025']);
    expect(body.plant.claim?.quote).toMatch(/modern plant/);
    expect(body.plant.assessments[0]?.deferredMaintenance).not.toBeNull();
    expect(body.quality).toMatchObject({ reports: [{ stars: 4 }], claims: [{ status: 'VERIFIED' }] });
    expect(body.trend.years[0]?.ratios.map((entry) => entry.key)).toEqual(['labour', 'contract_labour', 'supplies', 'capital', 'repairs']);
    // The pack's own figures on Finances.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as { calculator: string; metrics: { key: string; value: string | null }[] };
    expect(metrics.calculator).toBe('hospitals-operations');
    expect(metrics.metrics.find((metric) => metric.key === 'capex_ratio')?.value).toBe('0.0260');
    expect(metrics.metrics.find((metric) => metric.key === 'privileges_lapsed')?.value).toBe('7');
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/hospitals`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/hospitals`, 'other')).status).toBe(404);
  });

  it('accepting the capex takes it off the price in a payer-mix-adjusted EBITDA run', async () => {
    const capex = (await findings()).find((finding) => finding.title === 'Committed regulatory capex');
    const lines = await acceptAndValue(deal, { id: capex?.id ?? '', version: capex?.version ?? 1 }, {
      assumptions: {
        method: 'PAYER_MIX_EBITDA',
        ebitda: '6000000.00',
        netRevenue: '40000000.00',
        multiple: '9',
        payers: [{ payer: 'Government programme A (synthetic)', share: '0.567', rateChange: '-0.02' }],
      },
    });
    expect(lines.find((line) => line.kind === 'ENTERPRISE_VALUE')?.amount.amount).toBe('49917600.00'); // (6,000,000 − 40m × 0.567 × 2%) × 9
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: capex?.id, amount: { amount: `-${capex?.pricedRisk?.low}.00` } });
  });

  it('a withdrawn P&L leaves the trend; a single-year re-import reads one year and drafts no capex trend', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/hospitals`, 'lead')).body as { trend: { years: unknown[] }; plant: { years: unknown[] } };
    expect(after.trend.years).toEqual([]);
    expect(after.plant.years).toEqual([]);
    const single = 'Line,FY2025\nNet patient service revenue,39400000.00\nCapital-related costs: plant and equipment,1024400.00\n';
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl-fy2025.csv`, 'lead', single);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: { 'Net patient service revenue': 'REVENUE', 'Capital-related costs: plant and equipment': 'OPEX' } };
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping })).status).toBe(200);
    expect((await runRules()).status).toBe(200);
    const titles = (await findings()).map((finding) => finding.title);
    expect(titles).toContain('P&L for 2025: one year imported');
    expect(titles.filter((title) => title.startsWith('Capital spend fell'))).toHaveLength(1);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
