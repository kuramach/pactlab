import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, type AcceptanceDeal, acceptAndValue, type Body, centsOf, csvRows, HISTORY_YEARS as YEARS, type PackMetricsBody, pdfOf, startAcceptanceDeal } from './acceptance-kit';

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

/** A cited quote as one line: the PDF wraps long sentences. */
const flat = (quote: string | undefined) => quote?.replace(/\s+/g, ' ');
/** Line kinds a person confirms for the demo P&L: revenue lines, "cost of" lines, the rest operating costs. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : /^cost of/i.test(account) ? 'COGS' : 'OPEX');

/**
 * T-064 and T-163 acceptance: pactlab-demo-data/pharma-biotech/<CURRENCY> loaded into a fresh deal through the
 * real APIs — billing, the patent schedule, the pipeline, the trial-registry records, the obligations model,
 * the R&D roster, the five-year P&L and every document — surfaces the T-064 three and the planted (a) the
 * lead asset claimed Phase 2 against a Phase 1 registry filing, (b) the key patent expiring 18 months after
 * closing, priced into the bridge, (c) a milestone due at the next phase start missing from the seller's
 * model and (d) R&D flat across the years while the timeline is brought forward, as cited drafts; the claims
 * register holds each pipeline claim; the Pipeline view is the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('pharma and biotech pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('PHARMA_BIOTECH', currency);
    // An HR file giving the key scientist a retention agreement must never be read by a rule (rule 7).
    const hr = await deal.call('POST', `/v1/deals/${deal.dealId}/documents`, 'lead', {
      fileName: 'hr-notes.pdf',
      contentType: 'application/pdf',
      contentBase64: pdfOf('S-01 has signed a retention agreement running to 2030.').toString('base64'),
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
    expect(run.body).toMatchObject({ pack: 'PHARMA_BIOTECH', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(13);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-064, unchanged.
    const forecast = byTitle['Key patent expires earlier than the forecast assumes'];
    expect(forecast).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });
    expect(forecast?.description).toMatch(/^The forecast assumes Product A exclusivity through 2031; its composition-of-matter patents expire by 2028-/);
    expect(byTitle['Open manufacturing observations at the supplier']).toMatchObject({ domain: 'REGULATORY', direction: 0 });
    const share = deal.readme.match(/royalty line alone is ([0-9.]+%) of September 2026 revenue/)?.[1];
    expect(byTitle['Partner concentration']?.description).toContain(`Its largest line, Aldermoor Therapeutics — royalties on Product A (synthetic), is ${share}.`);

    // (a) The lead asset is claimed Phase 2; the registry record supplied says Phase 1, and the FDA minutes are quoted.
    const lead = byTitle['Claim contradicted: PX-410 phase'];
    expect(lead).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: null });
    expect(lead?.description).toContain('CTR-2025-04101 is registered as Phase 1 (recruiting)');
    expect(lead?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(2);
    expect(flat(lead?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote)).toBe('The sponsor presented the ongoing Phase 1 dose-escalation study of PX-410 (CTR-2025-04101).');
    expect(byTitle['Claim verified: PX-330 phase']).toMatchObject({ direction: 1 });
    expect(byTitle['Claim not verified: PX-410 timeline']).toMatchObject({ direction: 0 });

    // (b) The key patent expires 18 months after the stated closing, a patent record governing; priced on Product A's billed revenue.
    const cliff = byTitle['Key patent expires 18 months after closing: Product A'];
    expect(cliff).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: { type: 'PRICE_REDUCTION', currency } });
    expect(cliff?.description).toContain('first ends in US on 2028-03-31, 18 months after closing (2026-09-30) and inside the 5-year hold to 2031-09-30');
    expect(Number(cliff?.pricedRisk?.high)).toBeCloseTo(Number(cliff?.pricedRisk?.low) * 3.5, 1);
    expect(cliff?.evidence.map((link) => flat(link.documentCitation?.quote))).toEqual(
      expect.arrayContaining(['Patent family PF-01 (US), composition of matter covering Product A, is in force and expires on 31 March 2028.', 'The target closing date is 30 September 2026.']),
    );

    // (c) The milestone due at PX-330's Phase 2 start is in the licence agreement and missing from the seller's model.
    const milestone = byTitle["Milestone payment omitted from the seller's model: Brennick Biologics (synthetic)"];
    expect(milestone).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: { type: 'PRICE_REDUCTION', currency } });
    expect(milestone?.pricedRisk?.low).toBe(milestone?.pricedRisk?.high);
    expect(milestone?.description).toContain("The pipeline schedule expects PX-330's Phase 2 start in 2027-Q3.");
    expect(flat(milestone?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote)).toMatch(/^7\.1 .* shall pay Brennick Biologics \(synthetic\) a milestone payment of /);

    // (d) R&D flat across FY2021–FY2025 while the deck brings the readout forward, cited to the five imported rows.
    const burn = byTitle['R&D spend flat while the timeline is brought forward, 2021–2025'];
    expect(burn).toMatchObject({ domain: 'FINANCIAL', direction: -1, pricedRisk: null });
    expect(burn?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(5);
    expect(flat(burn?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote)).toBe('We have brought forward the PX-410 Phase 2 readout from 2028-Q4 to 2027-Q4.');
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });
    // (e) Five years of billing (T-184b): Product B's billed revenue falls every year, cited to the billing lines.
    const productB = byTitle['Product B revenue falling every year, FY2021–FY2025'];
    expect(productB).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(productB?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
    expect(Object.keys(byTitle).some((title) => title.startsWith('Product A revenue falling'))).toBe(false);

    // Dependence: one manufacturer, and a key scientist the HR file (never read) would have cleared.
    expect(byTitle['Single-source manufacturing: Product A']).toMatchObject({ domain: 'OPERATIONAL', direction: 0 });
    expect(byTitle['Key-scientist concentration: S-01']).toMatchObject({ domain: 'PEOPLE', direction: -1 });
  });

  it('the claims register holds each pipeline claim with its status and evidence', async () => {
    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as { statement: string; status: string; origin: string }[];
    const pipeline = claims.filter((claim) => /^PX-\d+/.test(claim.statement));
    expect(pipeline.map((claim) => `${claim.statement.split(' ')[0]?.replace(':', '')}:${claim.status}`).sort()).toEqual(['PX-330:VERIFIED', 'PX-410:CONTRADICTED', 'PX-410:UNVERIFIED']);
    expect(pipeline.every((claim) => claim.origin === 'PACK_RULE')).toBe(true);
  });

  it('the Pipeline view reads the claims, the estate against the hold, the obligations, dependence and the burn', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/pharma`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & {
      claims: { programmes: number; registeredTrials: number; items: { programme: string; aspect: string; status: string }[] };
      patents: { hold: { from: string; basis: string; years: number; to: string }; estate: { family: string; jurisdiction: string; basis: string; expiry: string }[]; cliffs: { product: string; state: string; monthsAfterClosing: number }[] };
      obligations: { modelImported: boolean; checks: { kind: string; state: string; expected: { expected: string } | null }[] };
      dependence: { manufacturing: { product: string; singleSource: boolean }[]; concentrated: { scientistRef: string }[] };
      burn: { flat: boolean; years: { year: string; files: { fileName: string }[] }[]; accelerations: { from: string; to: string }[] };
    };
    expect(body).toMatchObject({ version: 'pharma-pipeline-1', currency, canRunChecks: true });
    expect(body.claims).toMatchObject({ programmes: 2, registeredTrials: 2 });
    expect(body.claims.items.find((claim) => claim.programme === 'PX-410' && claim.aspect === 'PHASE')?.status).toBe('CONTRADICTED');
    expect(body.patents.hold).toMatchObject({ from: '2026-09-30', basis: 'EXPECTED_CLOSING', years: 5, to: '2031-09-30' });
    expect(body.patents.estate.find((entry) => entry.family === 'PF-01' && entry.jurisdiction === 'EP')).toMatchObject({ basis: 'DOCUMENT', expiry: '2028-06-30' });
    expect(body.patents.cliffs.map((cliff) => [cliff.product, cliff.state])).toEqual([['Product A', 'IN_HOLD'], ['Product B', 'AFTER_HOLD']]);
    expect(body.obligations.modelImported).toBe(true);
    expect(body.obligations.checks.map((check) => `${check.kind}:${check.state}`)).toEqual(['milestone:OMITTED', 'milestone:IN_MODEL', 'royalty:IN_MODEL', 'licence_fee:IN_MODEL']);
    expect(body.obligations.checks[0]?.expected?.expected).toBe('2027-Q3');
    expect(body.dependence.manufacturing).toMatchObject([{ product: 'Product A', singleSource: true }]);
    expect(body.dependence.concentrated.map((entry) => entry.scientistRef)).toEqual(['S-01']);
    expect(body.burn).toMatchObject({ flat: true, accelerations: [{ from: '2028-Q4', to: '2027-Q4' }] });
    expect(body.burn.years.map((year) => year.year)).toEqual([...YEARS]);
    expect(body.burn.years[0]?.files.map((file) => file.fileName)).toEqual(['pnl.csv']);
    // The pack's own figures on Finances.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('pharma-pipeline');
    // Five years side by side (T-184b), hand-computed from the billing export: Σ billed on Product B's lines by year.
    const lines = csvRows(deal.folder, 'invoice-lines.csv');
    const productBOf = (year: string) => {
      const cents = centsOf(lines.filter((row) => row[10]?.startsWith(year) && row[3]?.includes('Product B')), 7);
      return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
    };
    expect(metrics.history?.years).toEqual(YEARS.map((year) => `FY${year}`));
    expect(metrics.history?.rows.find((row) => row.key === 'product_product_b')?.values).toEqual(YEARS.map(productBOf));
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 years; earlier years not provided)', 'FY2021–FY2025 (5 years; earlier years not provided)']);
    expect(metrics.history?.asks).toEqual([]);
    expect(metrics.metrics.find((metric) => metric.key === 'programmes_registered')?.value).toBe('2');
    expect(metrics.metrics.find((metric) => metric.key === 'rd_latest_year')?.value).not.toBeNull();
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/pharma`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/pharma`, 'other')).status).toBe(404);
  });

  it('the patent cliff, priced from the evidence, reaches a DCF run on the bridge', async () => {
    const cliff = (await findings()).find((finding) => finding.title === 'Key patent expires 18 months after closing: Product A');
    const lines = await acceptAndValue(deal, { id: cliff?.id ?? '', version: cliff?.version ?? 1 }, {
      assumptions: {
        method: 'DCF',
        baseRevenue: '9000000',
        years: [1, 2, 3, 4, 5].map(() => ({ growth: '0.04', fcfMargin: '0.30' })),
        discountRate: '0.12',
        terminal: { kind: 'GORDON', growth: '0.01' },
      },
    });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: cliff?.id, amount: { amount: `-${cliff?.pricedRisk?.low}` } });
  });

  it('the reviewer prices the forecast exposure (T-064); accepted, it reaches a DCF run', async () => {
    const patent = (await findings()).find((finding) => finding.title === 'Key patent expires earlier than the forecast assumes');
    const lines = await acceptAndValue(deal, { id: patent?.id ?? '', version: patent?.version ?? 1 }, {
      pricedRisk: { type: 'PRICE_REDUCTION', currency, low: '2500000.00', high: '6000000.00', basis: 'Product A royalties 2028–2031 at generic erosion (synthetic).' },
      assumptions: {
        method: 'DCF',
        baseRevenue: '8000000',
        years: [1, 2, 3, 4, 5].map(() => ({ growth: '0.04', fcfMargin: '0.30' })),
        discountRate: '0.12',
        terminal: { kind: 'GORDON', growth: '0.01' },
      },
    });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: patent?.id, amount: { amount: '-2500000.00' } });
  });

  it('a withdrawn P&L leaves the burn and the trend; a single-year re-import reads one year and drafts no burn finding', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/pharma`, 'lead')).body as { burn: { years: unknown[]; flat: boolean | null }; trend: { years: unknown[] } };
    expect(after.burn).toMatchObject({ years: [], flat: null });
    expect(after.trend.years).toEqual([]);
    const single = 'Line,FY2025\nRoyalty revenue,100000.00\nResearch and development,20000.00\n';
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl-fy2025.csv`, 'lead', single);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: { 'Royalty revenue': 'REVENUE', 'Research and development': 'OPEX' } };
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping })).status).toBe(200);
    expect((await runRules()).status).toBe(200);
    const titles = (await findings()).map((finding) => finding.title);
    expect(titles).toContain('P&L for 2025: one year imported');
    expect(titles.filter((title) => title.startsWith('R&D spend flat'))).toHaveLength(1);
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
