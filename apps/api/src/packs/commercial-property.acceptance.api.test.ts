import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, acceptAndValue, startAcceptanceDeal, type AcceptanceDeal, type Body } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  domain: string;
  version: number;
  direction: number | null;
  description: string;
  pricedRisk: { type: string; low: string; high: string; currency: string } | null;
  valueConfirmation: { valueDriver: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/** Line kinds a person confirms for the demo statement: the revenue lines, and the rest operating costs. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : 'OPEX');

/**
 * T-066 and T-165 acceptance: pactlab-demo-data/commercial-property/<CURRENCY> loaded into a fresh deal through
 * the real APIs — billing, the rent roll, the CAM reconciliation, the capex schedule, the three-year P&L and
 * every document (the leases, the offering memorandum, the commission letter and the condition report) —
 * surfaces the folder's planted findings as cited drafts: the T-066 four, and (a) the rent roll overstating two
 * tenants' rent against their leases; (b) 41% of rent from a tenant whose lease expires in year one of the hold;
 * (c) an NNN recovery shortfall in every one of the three statement years, which a single year misses; and
 * (d) the condition report's roof absent from the seller's capex schedule, priced. The obligations the buyer
 * inherits are priced; the T-066 environmental escrow and the roof both reach a valuation run; the Leases view
 * is the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('commercial property pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('COMMERCIAL_PROPERTY', currency);
    // The operating statement by year (FY2023–FY2025), years across the columns, line kinds confirmed by a person.
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
    expect(run.body).toMatchObject({ pack: 'COMMERCIAL_PROPERTY', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(13);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-066, unchanged.
    const [, tenant, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of base rent/) ?? [];
    const walt = deal.readme.match(/Weighted average lease term is ([0-9.]+) years/)?.[1];
    const anchor = byTitle['Anchor tenant concentration and near-term expiry'];
    expect(anchor).toMatchObject({ domain: 'PROPERTY', direction: -1 });
    expect(anchor?.description).toContain(`${tenant} is ${share} of base rent and its lease ends 2027-06-30`);
    expect(anchor?.description).toContain(`Weighted average lease term is ${walt} years`);
    expect(anchor?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/Term ends 30 June 2027/);
    const environmental = byTitle['Recognized environmental condition'];
    expect(environmental).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: null });
    expect(environmental?.evidence.map((link) => link.documentCitation?.pageNumber)).toEqual([2, 2]);
    expect(byTitle['CAM recoveries below expenses']?.description).toMatch(/^In 2025, Repairs and maintenance .* and Security .* recovered less than they cost/);
    const upside = byTitle['Below-market anchor rent (upside, not price)'];
    expect(upside).toMatchObject({ domain: 'PROPERTY', direction: 1, pricedRisk: null, valueConfirmation: { valueDriver: 'Below-market anchor rent' } });
    expect(upside?.description).toMatch(/pays 6\.0% below market rent — the deepest discount on the rent roll/);

    // (a) Two tenants' roll rent above their leases, cited to the rent-roll row and the lease's rent and escalation.
    for (const [name, gap] of [['Pellham Engineering (synthetic)', '8.0%'], ['Teal Harbor Software (synthetic)', '10.0%']] as const) {
      const overstated = byTitle[`Rent roll overstates rent: ${name}`];
      expect(overstated, name).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: null });
      expect(overstated?.description).toContain(`(${gap}) above the lease`);
      expect(overstated?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(1);
      expect(overstated?.evidence.map((link) => link.documentCitation?.quote).filter(Boolean)).toEqual([expect.stringMatching(/^Base rent is [A-Z]{3} [0-9,.]+ per month/), 'Base rent increases by 3% on each anniversary of the commencement date.']);
    }

    // (b) 41% of the rent from the anchor, expiring in year 1 of the hold from the stated closing.
    const cliff = byTitle['Lease-expiry cliff: Corvane Logistics (synthetic) (41.0% of rent) expires in year 1 of the hold'];
    expect(cliff).toMatchObject({ domain: 'PROPERTY', direction: -1 });
    expect(cliff?.description).toContain('in year 1 of a 5-year hold from the expected closing on 31 December 2026');
    expect(cliff?.evidence.map((link) => link.documentCitation?.quote).filter(Boolean)).toEqual(['The term commences on 1 July 2021 and ends on 30 June 2027.', expect.stringContaining('The expected closing date is 31 December 2026.')]);

    // (c) Recoveries short in every statement year — a trend, cited to the statement lines and the net leases.
    const recoveries = byTitle['NNN recoveries short of the leases every year, 2023–2025'];
    expect(recoveries).toMatchObject({ domain: 'PROPERTY', direction: -1 });
    expect(recoveries?.description).toMatch(/2023: recoverable .* \(9\.0%\)\. 2024: .* \(9\.0%\)\. 2025: .* \(9\.0%\)\./);
    expect(recoveries?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(18);
    expect(recoveries?.evidence.filter((link) => link.documentCitation)).toHaveLength(9);

    // (d) The roof the condition report flags, absent from the capex schedule, priced as remediation at its estimate.
    const roof = byTitle['Condition item missing from the capex schedule: Roof'];
    expect(roof).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency } });
    expect(roof?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/^Roof: the membrane roofs .* estimated\s+cost\s+of\s+[A-Z]{3}\s+[0-9,]+\.$/s);

    // The obligations register, priced into the bridge.
    for (const title of ['Unfunded tenant improvement allowance: Pellham Engineering (synthetic)', 'Unpaid leasing commission: Harbourline Realty Advisors (synthetic)', 'Committed capex outstanding: Parking lot resurfacing']) {
      expect(byTitle[title], title).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'PRICE_REDUCTION', currency } });
    }
    // The statements tie to the leases, so no reconciliation finding; the trend is a record.
    expect(Object.keys(byTitle).some((title) => title.startsWith('Statement rent does not tie'))).toBe(false);
    expect(byTitle['P&L trend, 2023–2025']).toMatchObject({ direction: 0 });
  });

  it('the Leases view recomputes the rent, the statements, the recoveries, the hold and the condition items', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/commercial-property`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & {
      rentRoll: { suites: number; rows: { suite: string; state: string }[] };
      statementRent: { complete: boolean; years: { year: string; ties: boolean }[] };
      recoveries: { netLeases: number; persistent: boolean; years: { year: string; short: boolean }[] };
      obligations: { kind: string; outstanding: boolean }[];
      tenants: { rows: { tenant: string; share: string; holdYear: number | null; cliff: boolean }[]; expiryProfile: { label: string }[] };
      condition: { scheduleImported: boolean; items: { element: string; covered: string[] }[] };
      trend: { years: { year: string; files: { fileName: string }[] }[] };
    };
    expect(body).toMatchObject({ version: 'commercial-property-leases-1', currency, canRunChecks: true, asOf: '2026-09-30', leasesRead: 11, hold: { from: '2026-12-31', basis: 'EXPECTED_CLOSING', years: 5, yearsStated: true } });
    expect(body.rentRoll.suites).toBe(11);
    expect(body.rentRoll.rows.filter((row) => row.state === 'OVERSTATED').map((row) => row.suite)).toEqual(['Unit 2', 'Unit 6']);
    expect(body.rentRoll.rows.filter((row) => row.state === 'MATCHES')).toHaveLength(9);
    expect(body.statementRent).toMatchObject({ complete: true });
    expect(body.statementRent.years.map((year) => [year.year, year.ties])).toEqual([['2023', true], ['2024', true], ['2025', true]]);
    expect(body.recoveries).toMatchObject({ netLeases: 9, persistent: true });
    expect(body.recoveries.years.map((year) => [year.year, year.short])).toEqual([['2023', true], ['2024', true], ['2025', true]]);
    expect(body.obligations.filter((entry) => entry.outstanding).map((entry) => entry.kind).sort()).toEqual(['COMMITTED_CAPEX', 'LEASING_COMMISSION', 'TENANT_IMPROVEMENT']);
    expect(body.tenants.rows[0]).toMatchObject({ tenant: 'Corvane Logistics (synthetic)', holdYear: 1, cliff: true });
    expect(Number(body.tenants.rows[0]?.share)).toBeCloseTo(0.41, 2);
    expect(body.tenants.expiryProfile.map((bucket) => bucket.label)).toEqual(['Before closing', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'After the hold']);
    expect(body.condition.scheduleImported).toBe(true);
    expect(body.condition.items.map((item) => [item.element, item.covered.length > 0])).toEqual([['roof', false], ['hvac', true], ['parking', true]]);
    expect(body.trend.years.map((year) => [year.year, year.files.map((file) => file.fileName)])).toEqual([['2023', ['pnl.csv']], ['2024', ['pnl.csv']], ['2025', ['pnl.csv']]]);
    // The pack's own figures on Finances.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as { calculator: string; metrics: { key: string; value: string | null }[] };
    expect(metrics.calculator).toBe('commercial-property-leases');
    expect(Number(metrics.metrics.find((metric) => metric.key === 'statement_recovery_ratio')?.value)).toBeGreaterThan(0.8);
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/commercial-property`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/commercial-property`, 'other')).status).toBe(404);
  });

  it('the reviewer prices the environmental condition as an escrow; accepted, it is held back in an NOI ÷ cap-rate run', async () => {
    const environmental = (await findings()).find((finding) => finding.title === 'Recognized environmental condition');
    const lines = await acceptAndValue(deal, { id: environmental?.id ?? '', version: environmental?.version ?? 1 }, {
      pricedRisk: { type: 'ESCROW', currency, low: '250000.00', high: '900000.00', basis: 'Phase II and remediation estimate range (synthetic).' },
      assumptions: { method: 'NOI_CAP_RATE', noi: '1500000.00', capRate: '0.065' },
    });
    expect(lines.find((line) => line.kind === 'HOLDBACK')).toMatchObject({ findingId: environmental?.id, amount: { amount: '-250000.00' } });
  });

  it('accepted, the roof the capex schedule omits comes off the price in an NOI ÷ cap-rate run', async () => {
    const roof = (await findings()).find((finding) => finding.title === 'Condition item missing from the capex schedule: Roof');
    const lines = await acceptAndValue(deal, { id: roof?.id ?? '', version: roof?.version ?? 1 }, { assumptions: { method: 'NOI_CAP_RATE', noi: '1500000.00', capRate: '0.065' } });
    const [whole = '0', fraction = ''] = (roof?.pricedRisk?.low ?? '').split('.');
    expect(lines.find((line) => line.findingId === roof?.id)).toMatchObject({ amount: { amount: `-${whole}.${fraction.padEnd(2, '0')}` } });
  });

  it('a withdrawn P&L leaves the statements: no years, no recoveries, no trend', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/commercial-property`, 'lead')).body as { trend: { years: unknown[] }; recoveries: { years: unknown[] }; statementRent: { years: unknown[] } };
    expect(after.trend.years).toEqual([]);
    expect(after.recoveries.years).toEqual([]);
    expect(after.statementRent.years).toEqual([]);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
