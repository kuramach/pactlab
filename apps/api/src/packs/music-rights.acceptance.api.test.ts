import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoModelResponse } from '../demo-seed/seed';
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
type CatalogView = {
  currency: string;
  register: { works: number; confirmedEntries: number; corroboratedEntries: number; proposedEntries: number };
  income: { latestPeriodEnd: string; trailing: string; decayAdjusted: string; periods: string[]; gaps: unknown[] };
  termination: { share: string; exposedIncome: string; holdYears: number; holdSource: string; material: boolean; conventions: string[] };
  documents: { id: string; fileName: string }[];
  guardrail: string;
};

const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
const gateway = () => new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } });
const grouped = (amount: string) => Number(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * T-140 acceptance: pactlab-demo-data/music-rights/<CURRENCY> loaded into a fresh deal runs end to
 * end — the register, the income model and the termination analysis on the Catalog tab, every
 * planted defect as a cited draft (a missing assignment on the hit, termination windows inside the
 * hold on ~30% of income, splits totalling 105%, an unrecouped advance the summary omits), entries
 * read from documents by a scripted model and confirmed by a person, and the bridge.
 */
describe.each(ACCEPTANCE_CURRENCIES)('music rights pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];
  const catalog = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/catalog`, 'lead')).body as unknown as CatalogView;

  beforeAll(async () => {
    deal = await startAcceptanceDeal('MUSIC_RIGHTS', currency, { gateway: gateway() });
  }, 180_000);
  afterAll(async () => deal?.close());

  it('the Catalog tab shows the register, the income model and the termination exposure, with the guardrail', async () => {
    const view = await catalog();
    expect(view.currency).toBe(currency);
    expect(view.register.works).toBe(120);
    expect(view.income).toMatchObject({ latestPeriodEnd: '2026-06-30', periods: ['2024-12-31', '2025-06-30', '2025-12-31', '2026-06-30'], gaps: [] });
    expect(deal.readme).toContain(`trailing net income of ${currency} ${grouped(view.income.trailing)}`);
    expect(new Number(view.income.decayAdjusted).valueOf()).toBeLessThan(Number(view.income.trailing));
    const [, share] = deal.readme.match(/grants behind ([0-9.]+%) of trailing income/) ?? [];
    expect(`${(Number(view.termination.share) * 100).toFixed(1)}%`).toBe(share);
    expect(view.termination).toMatchObject({ holdYears: 10, holdSource: 'DEFAULT', material: true });
    expect(view.termination.conventions.join(' ')).toMatch(/§203/);
    expect(view.guardrail).toMatch(/not legal advice/);
    const works = await deal.call('GET', `/v1/deals/${deal.dealId}/catalog/works?limit=5`, 'lead');
    expect(works.body).toMatchObject({ total: 120, limit: 5 });
    expect((works.body['items'] as { title: string }[])[0]?.title).toBe('Harbour Lights');
    const next = await deal.call('GET', `/v1/deals/${deal.dealId}/catalog/works?limit=5&cursor=${String(works.body['nextCursor'])}`, 'lead');
    expect((next.body['items'] as { workId: string }[]).map((work) => work.workId)).not.toContain('W-0042');
  });

  it('every planted defect surfaces as a cited draft; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'MUSIC_RIGHTS', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    for (const [, title] of deal.readme.matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)) expect(byTitle[title ?? ''], title).toBeDefined();
    // (a) the hit work with no assignment behind it.
    expect(byTitle['Chain-of-title gap: Harbour Lights']).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });
    // (b) termination windows inside the hold, quantified as the exposed share.
    const termination = byTitle['Termination exposure inside the hold period'];
    expect(termination).toMatchObject({ domain: 'LEGAL', direction: -1 });
    expect(termination?.description).toMatch(/^Grants behind 30\.[0-9]% of trailing income/);
    // (c) splits totalling 105%.
    const [, splitTitle] = deal.readme.match(/\*\*(Split mismatch: .+?)\*\*/) ?? [];
    expect(byTitle[splitTitle ?? '']?.description).toMatch(/total 105%, not 100%/);
    // (d) the unrecouped advance the summary omits, priced off the price from the ledger.
    const advance = byTitle['Unrecouped advance not disclosed'];
    const [, ledgerCurrency, ledger] = deal.readme.match(/shows ([A-Z]{3}) ([0-9,]+) unrecouped/) ?? [];
    expect(advance).toMatchObject({ domain: 'FINANCIAL', direction: -1, pricedRisk: { type: 'PRICE_REDUCTION', currency: ledgerCurrency } });
    expect(Number(advance?.pricedRisk?.high)).toBe(Number((ledger ?? '').replaceAll(',', '')));
    expect(advance?.evidence.map((link) => link.documentCitation?.pageNumber)).toEqual([2, 2]);
    // The lien the summary does not disclose feeds an indemnity.
    expect(byTitle['Undisclosed encumbrance: Northgate Credit Partners (synthetic)']).toMatchObject({ direction: -1, pricedRisk: { type: 'INDEMNITY' } });
    expect(byTitle['Income concentration: Harbour Lights']).toMatchObject({ direction: 0 });
  });

  it('AI reads the rights documents; nothing counts until a person confirms, and the catalog checks add nothing new', async () => {
    const before = await catalog();
    const read = async (name: string) => {
      const document = before.documents.find((entry) => entry.fileName === name);
      const response = await deal.call('POST', `/v1/deals/${deal.dealId}/catalog/extract`, 'lead', { documentId: document?.id });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response.body;
    };
    expect(await read('02-split-sheet-w0077.pdf')).toMatchObject({ proposed: 2, rejected: [] });
    expect(await read('04-administration-ledger.pdf')).toMatchObject({ proposed: 1 });
    expect(await read('04-administration-ledger.pdf')).toMatchObject({ proposed: 0 });
    const proposed = (await deal.call('GET', `/v1/deals/${deal.dealId}/catalog/items?status=PROPOSED`, 'lead')).body as { items: { id: string; kind: string; value: string }[]; total: number };
    expect(proposed.total).toBe(3);
    expect((await catalog()).register).toMatchObject({ confirmedEntries: 0, proposedEntries: 3 });
    // A figure not in the quote is refused at confirmation.
    const split = proposed.items.find((item) => item.kind === 'SPLIT');
    const wrong = await deal.call('POST', `/v1/deals/${deal.dealId}/catalog/items/${split?.id}/decision`, 'lead', { decision: 'CONFIRM', value: '45' });
    expect(wrong.status).toBe(422);
    for (const item of proposed.items) expect((await deal.call('POST', `/v1/deals/${deal.dealId}/catalog/items/${item.id}/decision`, 'lead', { decision: 'CONFIRM' })).status).toBe(200);
    const after = await catalog();
    // The split sheet's entries corroborate the imported splits: confirmed, never counted twice.
    expect(after.register).toMatchObject({ confirmedEntries: 3, corroboratedEntries: 2, proposedEntries: 0 });
    expect(after.income.trailing).toBe(before.income.trailing);
    const checks = await deal.call('POST', `/v1/deals/${deal.dealId}/catalog/checks`, 'lead');
    expect(checks.status, JSON.stringify(checks.body)).toBe(200);
    expect(checks.body).toMatchObject({ created: 0, unresolvedQuotes: 0 });
  });

  it('the termination exposure, priced on its share at the royalty multiple, reaches the bridge as its own line', async () => {
    const view = await catalog();
    const termination = (await findings()).find((finding) => finding.title === 'Termination exposure inside the hold period');
    const multiple = '12';
    const exposed = (Number(view.termination.exposedIncome) * Number(multiple)).toFixed(2);
    const lines = await acceptAndValue(deal, { id: termination?.id ?? '', version: termination?.version ?? 1 }, {
      pricedRisk: { type: 'PRICE_REDUCTION', currency, low: exposed, high: exposed, basis: 'Exposed trailing income × the royalty multiple (synthetic).' },
      assumptions: { method: 'ARR_MULTIPLE', arr: view.income.decayAdjusted, multiple },
    });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: termination?.id, amount: { amount: `-${exposed}` } });
  });

  it('accepting the undisclosed advance takes the ledger balance off the price', async () => {
    const advance = (await findings()).find((finding) => finding.title === 'Unrecouped advance not disclosed');
    const lines = await acceptAndValue(deal, { id: advance?.id ?? '', version: advance?.version ?? 1 }, { assumptions: { method: 'ARR_MULTIPLE', arr: (await catalog()).income.decayAdjusted, multiple: '12' } });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: advance?.id, amount: { amount: `-${Number(advance?.pricedRisk?.low).toFixed(2)}` } });
  });

  it('the catalog is the buyer’s: refused to the seller and invisible to another tenant', async () => {
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/catalog`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/catalog/items`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/catalog/checks`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/catalog`, 'other')).status).toBe(404);
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
  });
});
