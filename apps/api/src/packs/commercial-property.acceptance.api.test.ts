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
  valueConfirmation: { valueDriver: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/**
 * T-066 acceptance: pactlab-demo-data/commercial-property/<CURRENCY> loaded
 * into a fresh deal surfaces the four planted findings as cited drafts; the
 * environmental condition, priced by the reviewer as an escrow, reaches an
 * NOI ÷ cap-rate run as a holdback, and the below-market rent stays upside.
 */
describe.each(ACCEPTANCE_CURRENCIES)('commercial property pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('COMMERCIAL_PROPERTY', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the four planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'COMMERCIAL_PROPERTY', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(4);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 4 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's figures for this folder.
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
    expect(environmental?.description).toMatch(/dry-cleaning/);

    const cam = byTitle['CAM recoveries below expenses'];
    expect(cam).toMatchObject({ domain: 'PROPERTY', direction: -1 });
    expect(cam?.description).toMatch(/^In 2025, Repairs and maintenance .* and Security .* recovered less than they cost/);
    expect(cam?.evidence).toHaveLength(2);

    const upside = byTitle['Below-market anchor rent (upside, not price)'];
    expect(upside).toMatchObject({ domain: 'PROPERTY', direction: 1, pricedRisk: null, valueConfirmation: { valueDriver: 'Below-market anchor rent' } });
    expect(upside?.description).toMatch(/pays 6\.0% below market rent — the deepest discount on the rent roll/);
  });

  it('the reviewer prices the environmental condition as an escrow; accepted, it is held back in an NOI ÷ cap-rate run', async () => {
    const environmental = (await findings()).find((finding) => finding.title === 'Recognized environmental condition');
    const lines = await acceptAndValue(deal, { id: environmental?.id ?? '', version: environmental?.version ?? 1 }, {
      pricedRisk: { type: 'ESCROW', currency, low: '250000.00', high: '900000.00', basis: 'Phase II and remediation estimate range (synthetic).' },
      assumptions: { method: 'NOI_CAP_RATE', noi: '1500000.00', capRate: '0.065' },
    });
    expect(lines.find((line) => line.kind === 'HOLDBACK')).toMatchObject({ findingId: environmental?.id, amount: { amount: '-250000.00' } });
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
