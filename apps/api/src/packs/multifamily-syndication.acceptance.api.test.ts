import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoModelResponse } from '../demo-seed/seed';
import { ACCEPTANCE_CURRENCIES, startAcceptanceDeal, type AcceptanceDeal, type Body } from './acceptance-kit';

type Item = { id: string; kind: string; source: string; label: string | null; value: string | null; hurdle: string | null; status: string; origin: string; citation: { pageNumber: number; quote: string; valid: boolean }; check: { status: string } | null };
type Scenario = { scenario: string; result: { limitedPartners: { irr: string; equityMultiple: string; averageCashOnCash: string }; conventions: string[] } | null; error: string | null };
type Finding = { id: string; title: string; domain: string; status: string; direction: number | null; evidence: { documentCitation: { pageNumber: number; quote: string } | null }[] };
type Claim = { statement: string; origin: string; status: string; findings?: { id: string }[] };

const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;

/**
 * T-106 acceptance (PR 1, the sponsor's side): pactlab-demo-data/multifamily-syndication/<CURRENCY>
 * loaded into a fresh syndication pact. The Multifamily pack runs unchanged on the property; the
 * PPM, operating agreement and deck are read by `offering.extract` (scripted, no model), the sponsor
 * confirms every proposal, and the offering checks surface planted defects (a) to (c) as cited
 * drafts, with their claims in the claims register. The seller and other tenants never see the raise.
 */
describe.each(ACCEPTANCE_CURRENCIES)('multifamily syndication pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const url = () => `/v1/deals/${deal.dealId}/syndication`;
  const readme = (pattern: RegExp) => deal.readme.match(pattern)?.slice(1) ?? [];
  const view = async () => (await deal.call('GET', url(), 'lead')).body;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as Finding[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('MULTIFAMILY_SYNDICATION', currency, {
      dataClasses: { '01-offering-memorandum.md': 'FINANCIAL' },
      gateway: new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } }),
    });
  }, 180_000);
  afterAll(async () => deal?.close());

  it('the property side is the Multifamily pack, unchanged: its four findings surface', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'MULTIFAMILY_SYNDICATION', unresolvedQuotes: 0 });
    const titles = (await findings()).map((finding) => finding.title);
    for (const title of ['Offering memorandum NOI above the T-12', 'Deferred maintenance above the capital plan', 'Delinquency concentrated in Building C', 'Loss-to-lease (upside, not price)']) expect(titles).toContain(title);
    // Three of five prior deals carry actuals: the track record is not thin.
    expect(titles).not.toContain('Thin sponsor track record');
    const metrics = await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead');
    expect(metrics.body).toMatchObject({ calculator: 'multifamily-metrics' });
  });

  it('before the offering is entered, the waterfall says what it needs instead of guessing', async () => {
    const body = await view();
    expect(body, JSON.stringify(body)).toHaveProperty('offering');
    expect(body['offering']).toBeNull();
    expect((body['waterfall'] as Body)['unavailable']).toMatch(/Enter the offering/);
    expect(body['guardrail']).toMatch(/not legal advice, no accreditation determination/);
    const trackRecord = body['trackRecord'] as { deal: string; actualIrrPct: string | null }[];
    expect(trackRecord).toHaveLength(5);
    // Absence stays absence: no actual return is filled in for Stonebridge Flats.
    expect(trackRecord.find((row) => row.deal.startsWith('Stonebridge Flats'))?.actualIrrPct ?? null).toBeNull();
  });

  it('AI proposes grounded terms and claims; only what the sponsor confirms feeds the math', async () => {
    const [price, loan, equity] = readme(/purchase price `(\d+)`, loan `(\d+)` at `5`%, equity raised `(\d+)`/);
    const saved = await deal.call('PUT', `${url()}/offering`, 'lead', {
      currency, purchasePrice: price, loanAmount: loan, interestRatePct: '5', equityRaise: equity, holdYears: 5, sellingCostsPct: '2', noiYear1: null,
      downsideNoiGrowthPct: '1', baseNoiGrowthPct: '3', upsideNoiGrowthPct: '4.5', downsideExitCapPct: '6.5', baseExitCapPct: '6', upsideExitCapPct: '5.5', exemption: 'RULE_506C',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const sources = { PPM: '02-private-placement-memorandum.pdf', OPERATING_AGREEMENT: '03-operating-agreement.pdf', DECK: '04-investor-deck.pdf' } as const;
    for (const [source, file] of Object.entries(sources)) {
      const read = await deal.call('POST', `${url()}/extract`, 'lead', { documentId: deal.documents[file], source });
      expect(read.status, `${file}: ${JSON.stringify(read.body)}`).toBe(200);
      expect(Number(read.body['proposed']), file).toBeGreaterThan(0);
    }
    // Reading again adds nothing.
    const again = await deal.call('POST', `${url()}/extract`, 'lead', { documentId: deal.documents[sources.PPM], source: 'PPM' });
    expect(again.body).toMatchObject({ proposed: 0 });

    let items = (await view())['items'] as Item[];
    expect(items.every((item) => item.status === 'PROPOSED' && item.origin === 'AI' && item.citation.valid)).toBe(true);
    // Nothing confirmed yet: the waterfall waits for the operating agreement's terms.
    expect(((await view())['waterfall'] as Body)['unavailable']).toMatch(/Confirm the preferred return/);
    expect(items.filter((item) => item.kind === 'PROMOTE_TIER' && item.source === 'OPERATING_AGREEMENT').map((item) => [item.hurdle, item.value])).toEqual([['15', '30'], [null, '40']]);
    expect(items.find((item) => item.kind === 'OTHER_FEE')).toMatchObject({ source: 'OPERATING_AGREEMENT', label: 'Loan guarantee fee', value: '1' });

    for (const item of items) {
      const decided = await deal.call('POST', `${url()}/items/${item.id}/decision`, 'lead', { decision: 'CONFIRM' });
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    }
    items = (await view())['items'] as Item[];
    expect(items.every((item) => item.status === 'CONFIRMED')).toBe(true);
  });

  it('a correction must still be written in the quote; nothing typed by hand escapes the check either', async () => {
    const irrItem = ((await view())['items'] as Item[]).find((item) => item.kind === 'PROJECTED_IRR')!;
    const wrong = await deal.call('POST', `${url()}/items/${irrItem.id}/decision`, 'lead', { decision: 'CONFIRM', value: '99' });
    expect(wrong.status).toBe(422);
    expect(wrong.body['code']).toBe('FIGURE_NOT_IN_QUOTE');
    const typed = await deal.call('POST', `${url()}/items`, 'lead', {
      documentId: deal.documents['02-private-placement-memorandum.pdf'], pageNumber: 3, quote: 'Acquisition fee: 2% of the purchase price, paid at closing.', source: 'PPM', kind: 'ACQUISITION_FEE', label: null, value: '3', hurdle: null,
    });
    expect(typed.status).toBe(422);
  });

  it('the waterfall is recomputed from the operating agreement on three paths, labelled as scenarios', async () => {
    const waterfall = (await view())['waterfall'] as { scenarios: Scenario[]; unavailable: string | null; noiSource: string; unmodelled: string[] };
    expect(waterfall.unavailable).toBeNull();
    expect(waterfall.noiSource).toBe('T12');
    expect(waterfall.unmodelled).toEqual(['the loan guarantee fee']);
    const [irr, multiple, coc] = readme(/investor IRR ([0-9.]+)%, equity multiple ([0-9.]+)x, average cash-on-cash ([0-9.]+)%/);
    const base = waterfall.scenarios.find((scenario) => scenario.scenario === 'BASE')!;
    expect(base.result?.limitedPartners).toMatchObject({ irr, equityMultiple: multiple, averageCashOnCash: coc });
    expect(base.result?.conventions).toContain('A scenario computed from stated assumptions — not a projection or promise.');
    const lp = (name: string) => Number(waterfall.scenarios.find((scenario) => scenario.scenario === name)?.result?.limitedPartners.irr);
    expect(lp('DOWNSIDE')).toBeLessThan(lp('BASE'));
    expect(lp('UPSIDE')).toBeGreaterThan(lp('BASE'));
  });

  it('the offering checks surface planted defects (a) to (c) as cited drafts once, with their claims', async () => {
    const run = await deal.call('POST', `${url()}/checks`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body, JSON.stringify((await findings()).map((f) => f.title))).toMatchObject({ created: 3, existing: 0, unresolvedQuotes: 0 });
    expect((await deal.call('POST', `${url()}/checks`, 'lead')).body).toMatchObject({ created: 0, existing: 3 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    const [stated] = readme(/the PPM states ([0-9.]+)%/);
    const irr = byTitle['Stated investor IRR inconsistent with the recomputed waterfall'];
    expect(irr).toMatchObject({ status: 'DRAFT', domain: 'FINANCIAL', direction: 0 });
    expect(irr?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 5, quote: `Projected investor IRR: ${stated}%` });
    const stonebridge = byTitle['Track-record claim with no actuals behind it: Stonebridge Flats'];
    expect(stonebridge).toMatchObject({ status: 'DRAFT', domain: 'COMMERCIAL' });
    expect(stonebridge?.evidence.find((link) => link.documentCitation)?.documentCitation).toMatchObject({ pageNumber: 2 });
    const fee = byTitle['Fee in the operating agreement missing from the PPM: loan guarantee fee'];
    expect(fee).toMatchObject({ status: 'DRAFT', domain: 'LEGAL' });
    expect(fee?.evidence[0]?.documentCitation?.quote).toMatch(/^Loan guarantee fee: 1% of the original loan amount/);
    // The multiple and cash-on-cash the PPM states agree, and its fee summary and splits match the agreement.
    for (const title of Object.keys(byTitle)) expect(title).not.toMatch(/equity multiple|cash-on-cash|described differently|Fee differs/);

    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as Claim[];
    const claim = (pattern: RegExp) => claims.find((row) => row.origin === 'PACK_RULE' && pattern.test(row.statement));
    expect(claim(/projected investor IRR/)?.status).toBe('CONTRADICTED');
    expect(claim(/projected equity multiple/)?.status).toBe('VERIFIED');
    expect(claim(/Stonebridge Flats/)?.status).toBe('UNVERIFIED');
    expect(claim(/Cedar Hollow Apartments/)?.status).toBe('VERIFIED');
    expect(claim(/occupancy/)?.status).toBe('VERIFIED');
    expect(claim(/exit cap rate/)?.status).toBe('UNVERIFIED');
  });

  it('the raise is the sponsor\'s own side: the seller and other tenants cannot reach it', async () => {
    const seller = await deal.call('GET', url(), 'target_contributor');
    expect([403, 404]).toContain(seller.status);
    expect(JSON.stringify(seller.body)).not.toMatch(/Projected investor IRR|Preferred return|track record/i);
    expect([403, 404]).toContain((await deal.call('POST', `${url()}/checks`, 'target_contributor')).status);
    expect((await deal.call('GET', url(), 'other')).status).toBe(404);
    const sellerClaims = await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'target_contributor');
    expect(JSON.stringify(sellerClaims.body)).not.toMatch(/investor IRR|Stonebridge/);
  });
});
