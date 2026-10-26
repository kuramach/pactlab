import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, acceptAndValue, startAcceptanceDeal, type AcceptanceDeal } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  description: string;
  domain: string;
  version: number;
  direction: number | null;
  pricedRisk: { type: string; low: string; high: string; currency: string } | null;
  valueConfirmation: { valueDriver: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};
type Scenario = { pricePerShare: string; founders: { before: string; after: string }; poolShuffle: { shares: string; founderPointsLost: string; statement: string }; conversions: { securityId: string; basis: string; mfnFrom: string | null }[] };

/**
 * T-083 acceptance: pactlab-demo-data/venture-raise/<CURRENCY> (Loopwise, a
 * seed-stage startup) loaded into a fresh Venture Raise pact. The founder's
 * self-diligence surfaces the six planted findings once each, deck metrics
 * become claims, competing offers run through the round model side by side,
 * and the investor view carries nothing confidential.
 */
describe.each(ACCEPTANCE_CURRENCIES)('venture raise pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const base = () => `/v1/deals/${deal.dealId}`;
  const findings = async () => (await deal.call('GET', `${base()}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('VENTURE_RAISE', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the six planted findings surface once each, with the right directions', async () => {
    const run = await deal.call('POST', `${base()}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'VENTURE_RAISE', unresolvedQuotes: 0 });
    expect((await findings()).map((finding) => finding.title).sort()).toEqual([
      'Board composition after the round',
      'Cap table reconciles to the corporate record',
      'Deck ARR contradicted by billing',
      'IP assignment gap',
      'Runway shorter than the deck says',
      'SAFE stack converts into more than expected',
    ]);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(6);
    expect((await deal.call('POST', `${base()}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 6 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    const [, deckArr, billedArr] = deal.readme.match(/the deck states [A-Z]{3} ([0-9,]+); `invoice-lines.csv` bills [A-Z]{3} ([0-9,]+) ARR/) ?? [];
    const deck = byTitle['Deck ARR contradicted by billing'];
    expect(deck).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(deck?.description).toContain(`The deck states ARR of ${currency} ${deckArr}`);
    expect(deck?.description).toContain(`billing gives ${currency} ${billedArr} ARR for September 2026`);
    expect(deck?.evidence.find((link) => link.documentCitation)?.documentCitation?.pageNumber).toBe(2);

    expect(byTitle['SAFE stack converts into more than expected']?.description).toMatch(/^SAFE-1 has a most-favoured-nation clause, so it takes SAFE-3's cap of/);
    expect(byTitle['IP assignment gap']).toMatchObject({ domain: 'LEGAL', direction: -1 });
    expect(byTitle['IP assignment gap']?.description).toContain('Quillfield Design');
    expect(byTitle['Runway shorter than the deck says']?.description).toMatch(/^The deck states 18 months of runway\. .* is 12\.\d months/);
    expect(byTitle['Cap table reconciles to the corporate record']).toMatchObject({ direction: 1, valueConfirmation: { valueDriver: 'Clean capitalization' } });
    expect(byTitle['Board composition after the round']).toMatchObject({ direction: 0 });
  });

  it('deck metrics become claims: contradicted, with the finding and evidence linked', async () => {
    const claims = (await deal.call('GET', `${base()}/claims`, 'lead')).body['items'] as { statement: string; origin: string; status: string; evidenceItemIds: string[]; findings: { title: string }[] }[];
    const ruled = claims.filter((claim) => claim.origin === 'PACK_RULE');
    expect(ruled.map((claim) => [claim.status, claim.findings.map((finding) => finding.title)])).toEqual([
      ['CONTRADICTED', ['Deck ARR contradicted by billing']],
      ['CONTRADICTED', ['Runway shorter than the deck says']],
    ]);
    expect(ruled[0]?.statement).toMatch(/^ARR at 30 September 2026: /);
    expect(ruled.every((claim) => claim.evidenceItemIds.length > 0)).toBe(true);
  });

  it('competing offers run through the round model side by side, with the pool shuffle stated', async () => {
    const amount = (usd: number) => (currency === 'USD' ? usd : currency === 'EUR' ? usd * 0.92 : usd * 0.79).toFixed(2);
    expect((await deal.call('PUT', `${base()}/venture/settings`, 'lead', { expectedVersion: null, roundType: 'SEED_PRICED', currency, targetPreMoney: amount(10_000_000), raiseAmount: amount(2_000_000), poolTargetPct: '0.10', sector: 'SOFTWARE_SAAS' })).status).toBe(200);
    await deal.call('POST', `${base()}/venture/offers`, 'lead', { investorName: 'Harborline Ventures (synthetic)', counterpartyType: 'VC', status: 'TERM_SHEET', preMoney: amount(10_000_000), amount: amount(2_000_000), investorBoardSeats: 1 });
    await deal.call('POST', `${base()}/venture/offers`, 'lead', { investorName: 'Northfield Angels (synthetic)', counterpartyType: 'ANGEL', status: 'TERM_SHEET', preMoney: amount(8_000_000), amount: amount(1_000_000), poolTargetPct: '0.05', liquidationMultiple: '1.5', participating: true });
    const compared = await deal.call('GET', `${base()}/venture/offers/compare`, 'lead');
    expect(compared.status, JSON.stringify(compared.body)).toBe(200);
    const [vc, angel] = compared.body['offers'] as { scenario: Scenario; terms: { standardPreference: boolean; board: string | null } }[];
    expect(vc?.scenario.poolShuffle.statement).toMatch(/^The pool grows by \d+ shares before the money comes in, so existing holders pay for it: founders end [0-9.]+ points lower/);
    expect(Number(vc?.scenario.poolShuffle.founderPointsLost)).toBeGreaterThan(0);
    expect(vc?.scenario.conversions.find((entry) => entry.securityId === 'SAFE-1')).toMatchObject({ mfnFrom: 'SAFE-3' });
    expect(vc?.terms).toMatchObject({ standardPreference: true, board: 'The investor takes 1 board seat.' });
    expect(angel?.terms.standardPreference).toBe(false);
    expect(vc?.scenario.founders.after).not.toBe(angel?.scenario.founders.after);
    expect(compared.body['note']).toMatch(/does not rank offers or recommend one/);
    // The round model alone: the ask and 20% either side.
    const model = await deal.call('GET', `${base()}/venture/round-model`, 'lead');
    expect((model.body['scenarios'] as Scenario[]).map((scenario) => Number(scenario.founders.after))).toEqual([...(model.body['scenarios'] as Scenario[]).map((scenario) => Number(scenario.founders.after))].sort((a, b) => a - b));
  });

  it('readiness depends on the investor: a VC asks for more than an angel', async () => {
    const vc = (await deal.call('GET', `${base()}/venture/readiness?counterparty=VC`, 'lead')).body as { total: number; items: { id: string; present: boolean }[] };
    const angel = (await deal.call('GET', `${base()}/venture/readiness?counterparty=ANGEL`, 'lead')).body as { total: number; complete: boolean };
    expect(vc.total).toBeGreaterThan(angel.total);
    expect(angel.complete).toBe(true);
    expect(vc.items.find((item) => item.id === 'code')?.present).toBe(false);
    // With a VC offer active, the default checklist is the VC's.
    expect(((await deal.call('GET', `${base()}/venture/readiness`, 'lead')).body as { counterparty: string }).counterparty).toBe('VC');
  });

  it('the investor view holds no finding, no confidential claim and no other investor’s bid', async () => {
    const offers = (await deal.call('GET', `${base()}/venture/offers`, 'lead')).body['items'] as { id: string; investorName: string }[];
    const view = await deal.call('GET', `${base()}/venture/investor-view?offerId=${offers[0]?.id}`, 'lead');
    expect(view.status).toBe(200);
    const { excludes, ...shared } = view.body;
    expect(excludes).toMatch(/^Findings, unverified or contradicted claims/);
    const text = JSON.stringify(shared);
    for (const finding of await findings()) {
      expect(text).not.toContain(finding.id);
      expect(text).not.toContain(finding.title);
    }
    expect(text).not.toContain('Northfield Angels');
    expect(text).not.toMatch(/runway|cash_balance|CONTRADICTED/i);
    expect(view.body).toMatchObject({ offer: { investorName: 'Harborline Ventures (synthetic)' }, verifiedClaims: [], capTable: { sharesOutstanding: '10500000', convertingInstruments: 3 } });
    expect((view.body['dataRoom'] as { item: string }[]).map((entry) => entry.item)).toContain('Cap table');
  });

  it('accepting the contradicted deck ARR, priced by the founder, adjusts the round at the ask', async () => {
    const deck = (await findings()).find((finding) => finding.title === 'Deck ARR contradicted by billing');
    const lines = await acceptAndValue(deal, { id: deck?.id ?? '', version: deck?.version ?? 1 }, {
      pricedRisk: { type: 'PRICE_REDUCTION', currency, low: '500000.00', high: '900000.00', basis: 'Pre-money at billed rather than stated ARR (synthetic).' },
      assumptions: { method: 'ROUND_PRE_MONEY', preMoney: '10000000.00' },
    });
    expect(lines.find((line) => line.kind === 'ENTERPRISE_VALUE')?.amount.amount).toBe('10000000.00');
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: deck?.id, amount: { amount: '-500000.00' } });
  });

  it('is founder-side only: refused to target contributors and invisible to other tenants', async () => {
    for (const path of ['/venture/settings', '/venture/offers/compare', '/venture/investor-view']) {
      expect([403, 404], path).toContain((await deal.call('GET', `${base()}${path}`, 'target_contributor')).status);
      expect((await deal.call('GET', `${base()}${path}`, 'other')).status, path).toBe(404);
    }
  });
});
