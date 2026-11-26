import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, pdfOf, startAcceptanceDeal, type AcceptanceDeal, type Body } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  domain: string;
  status: string;
  direction: number | null;
  pricedRisk: { type: string; low: string; high: string; currency: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/** Line kinds a person confirms for the demo P&L: revenue lines, "cost of" lines, the rest operating costs. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : /^cost of/i.test(account) ? 'COGS' : 'OPEX');

/**
 * T-061 and T-160 acceptance: pactlab-demo-data/healthcare/<CURRENCY> loaded into a fresh healthcare
 * deal through the real APIs — billing, the claims summary and roster, the remittances, collections by
 * clinician, the credentialing and payer contract registers, the three-year P&L and every document —
 * surfaces the folder's planted findings as cited drafts: the T-061 four, and (a) a denial rate that
 * rises across the three years while the deck claims it fell, (b) two clinicians practising on expired
 * licences, (c) a payer mix shifted toward the lowest-paying payer against the deck's share, and (d) one
 * clinician carrying 31% of collections with no non-compete on file. The priced exposure reaches a
 * valuation run; the Practice view is the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('healthcare pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('HEALTHCARE', currency);
    // An HR file naming a clinician with a non-compete must never be read by a rule (rule 7).
    const hr = await deal.call('POST', `/v1/deals/${deal.dealId}/documents`, 'lead', {
      fileName: 'hr-notes.pdf',
      contentType: 'application/pdf',
      contentBase64: pdfOf('PR-03: non-compete, 24 months within 15 miles, signed 2024. PR-07: physical therapy licence, Ohio — active, expires on 31 December 2099.').toString('base64'),
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
    expect(run.body).toMatchObject({ pack: 'HEALTHCARE', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(15);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-061, unchanged.
    const government = byTitle['Revenue concentrated in government programmes'];
    const share = deal.readme.match(/are ([0-9.]+%) of September 2026 revenue/)?.[1];
    expect(government).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(JSON.stringify(government)).toContain(share ?? 'missing');
    const fee = byTitle['Medical-director fee above documented duties'];
    expect(fee).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: { type: 'INDEMNITY', currency } });
    expect(fee?.evidence.map((link) => link.documentCitation?.pageNumber)).toEqual([1, 1, 2]);
    expect(byTitle['Privacy risk assessment out of date']?.evidence[0]?.documentCitation?.quote).toMatch(/Assessment date: 14 March 2023/);
    expect(byTitle['Provider credentials expiring']?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(2);

    // (a) The denial rate rises across the three years; the deck says it fell. Cited to the deck and the remittances.
    const denialClaim = byTitle['Claim contradicted: Denial rate'];
    expect(denialClaim).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(denialClaim?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe('Claim denial rate fell from 8.4% in FY2023 to 6.1% in FY2025.');
    expect(denialClaim?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
    expect(byTitle['Denial rate rising, 2023–2025']).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    // …and its P&L side, which one year alone misses: write-offs outpacing revenue, cited to the three imported rows.
    const writeoffs = byTitle['Denial write-offs and bad debt growing faster than revenue, 2023–2025'];
    expect(writeoffs).toMatchObject({ direction: -1 });
    expect(writeoffs?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(3);
    expect(byTitle['P&L trend, 2023–2025']).toMatchObject({ direction: 0 });

    // (b) Two clinicians practising on expired licences: the register says active; the verification document governs.
    const practising = Object.values(byTitle).filter((finding) => finding.title.startsWith('Practising on an expired licence: '));
    expect(practising.map((finding) => finding.title).sort()).toEqual(['Practising on an expired licence: PR-07', 'Practising on an expired licence: PR-15']);
    for (const finding of practising) {
      expect(finding).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: null });
      expect(finding.evidence.find((link) => link.documentCitation)?.documentCitation).toMatchObject({ pageNumber: 2 });
      expect(finding.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/expired on \d+ \w+ 2026;/);
    }

    // (c) The payer mix shifted toward Medicaid, the lowest-paying class; the deck's commercial share is contradicted.
    expect(byTitle['Payer mix shifted toward Medicaid, the lowest-paying payer class, 2023–2025']).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(byTitle['Claim contradicted: Commercial payer share']?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe('Commercial payers were 41% of collections in FY2025.');
    expect(byTitle['Claim verified: Days in accounts receivable']?.direction).toBe(1);
    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as { statement: string; status: string; origin: string }[];
    expect(claims.filter((claim) => claim.origin === 'PACK_RULE').map((claim) => claim.status).sort()).toEqual(['CONTRADICTED', 'CONTRADICTED', 'VERIFIED']);

    // (d) One clinician carries 31% of collections with no non-compete on file; the HR look-alike was never read.
    const concentration = byTitle['31.0% of collections from one clinician, no non-compete on file: PR-03'];
    expect(concentration).toMatchObject({ domain: 'PEOPLE', direction: -1 });
    expect(concentration?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);

    expect(byTitle['Payer contract ends within a year: Commercial plan North (synthetic)']).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
  });

  it('the Practice view recomputes collections and the payer mix, reads the credentials, contracts and compliance evidence, and every P&L year with its file', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/healthcare`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & {
      collections: { trailing: Body; years: { label: string }[]; partialYears: string[] };
      credentials: { exceptions: { providerRef: string; state: string; registerDiffers: boolean }[]; unlicensed: string[]; total: number };
      clinicians: { items: { providerRef: string; covenant: unknown }[] };
      contracts: { payers: { payer: string; state: string }[] };
      compliance: { kinds: { kind: string; present: boolean }[] };
      reconciliation: { years: { year: string; reconciles: boolean }[] };
      trend: { years: { year: string; files: { fileName: string }[] }[] };
    };
    expect(body).toMatchObject({ version: 'healthcare-collections-1', currency, analysisDate: '2026-09-30', canRunChecks: true });
    expect(body.collections.trailing).toMatchObject({ from: '2025-10', to: '2026-09', missing: [] });
    expect(body.collections.years.map((year) => year.label)).toEqual(['2023', '2024', '2025']);
    expect(body.collections.partialYears).toEqual(['2026']);
    expect(body.credentials.exceptions.map((entry) => [entry.providerRef, entry.state, entry.registerDiffers])).toEqual([['PR-07', 'EXPIRED', true], ['PR-15', 'EXPIRED', true]]);
    expect(body.credentials.unlicensed).toEqual([]);
    expect(body.clinicians.items[0]).toMatchObject({ providerRef: 'PR-03', covenant: null });
    expect(body.clinicians.items.find((item) => item.providerRef === 'PR-01')?.covenant).toMatchObject({ pageNumber: 1 });
    expect(body.contracts.payers.find((payer) => payer.payer.startsWith('Commercial plan North'))?.state).toBe('EXPIRING');
    expect(body.compliance.kinds.map((entry) => [entry.kind, entry.present])).toEqual([['HIPAA_RISK_ASSESSMENT', true], ['CODING_AUDIT', true], ['LICENCE_VERIFICATION', true], ['RESTRICTIVE_COVENANTS', true]]);
    expect(body.reconciliation.years.map((year) => [year.year, year.reconciles])).toEqual([['2023', true], ['2024', true], ['2025', true]]);
    expect(body.trend.years.map((year) => [year.year, year.files.map((file) => file.fileName)])).toEqual([['2023', ['pnl.csv']], ['2024', ['pnl.csv']], ['2025', ['pnl.csv']]]);
    // The pack's own figures on Finances.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as { calculator: string; metrics: { key: string; value: string | null }[] };
    expect(metrics.calculator).toBe('healthcare-collections');
    expect(metrics.metrics.find((metric) => metric.key === 'top_clinician_share')?.value).toBe('0.3100');
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/healthcare`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/healthcare`, 'other')).status).toBe(404);
  });

  it('accepting the priced exposure reaches a valuation run as a holdback', async () => {
    const fee = (await findings()).find((finding) => finding.title === 'Medical-director fee above documented duties');
    const id = fee?.id ?? '';
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'lead', { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Agreement and time records checked' })).status).toBe(201);
    const accepted = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'reviewer', { expectedVersion: 2, decision: 'ACCEPTED', rationale: 'Fee exceeds documented duties' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const scenarios = `/v1/deals/${deal.dealId}/valuation/scenarios`;
    const created = await deal.call('POST', scenarios, 'lead', {
      name: 'Base case',
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '2000000.00', multiple: '3' },
        bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
        findingLinks: [{ findingId: id, point: 'LOW' }],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const scenarioId = (created.body['scenario'] as { id: string }).id;
    const ran = await deal.call('POST', `${scenarios}/${scenarioId}/runs`, 'lead', { expectedVersion: 1 });
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    const lines = (ran.body['latestRun'] as { result: { bridge: { lines: { kind: string; findingId?: string; amount: { amount: string } }[] } } }).result.bridge.lines;
    // An indemnity is held back from cash at close, not taken off the price.
    const line = lines.find((entry) => entry.kind === 'HOLDBACK');
    expect(line?.findingId).toBe(id);
    expect(line?.amount.amount.startsWith('-')).toBe(true);
  });

  it('a withdrawn P&L leaves the trend: the view reads no years and a single-year re-import reads one', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/healthcare`, 'lead')).body as { trend: { years: unknown[] }; reconciliation: { years: unknown[] } };
    expect(after.trend.years).toEqual([]);
    expect(after.reconciliation.years).toEqual([]);
    const single = 'Line,FY2025\nNet patient service revenue,100000.00\nDenial write-offs and bad debt,2000.00\n';
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl-fy2025.csv`, 'lead', single);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: { 'Net patient service revenue': 'REVENUE', 'Denial write-offs and bad debt': 'OPEX' } };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const one = (await deal.call('GET', `/v1/deals/${deal.dealId}/healthcare`, 'lead')).body as { trend: { years: { year: string }[] } };
    expect(one.trend.years.map((year) => year.year)).toEqual(['2025']);
    expect((await runRules()).status).toBe(200);
    const titles = (await findings()).map((finding) => finding.title);
    expect(titles).toContain('P&L for 2025: one year imported');
    expect(titles.filter((title) => title.startsWith('Denial write-offs and bad debt growing faster'))).toHaveLength(1);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
