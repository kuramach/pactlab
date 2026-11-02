import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, startAcceptanceDeal, type AcceptanceDeal } from './acceptance-kit';

type FindingView = {
  title: string;
  domain: string;
  direction: number | null;
  description: string;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/**
 * pactlab-demo-data/software-saas/<CURRENCY> loaded into a fresh Software & SaaS deal: "Run software & saas
 * checks" drafts exactly the four findings the README promises, each cited; a re-run adds nothing.
 */
describe.each(ACCEPTANCE_CURRENCIES)('software & saas pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const readme = (pattern: RegExp) => deal.readme.match(pattern)?.slice(1) ?? [];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('SOFTWARE_SAAS', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the four planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'SOFTWARE_SAAS', unresolvedQuotes: 0, created: 4 });
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 4 });

    const items = (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];
    const byTitle = Object.fromEntries(items.map((finding) => [finding.title, finding]));
    const promised = [...deal.readme.matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(Object.keys(byTitle).sort()).toEqual([...promised].sort());
    for (const finding of items) expect(finding.evidence.length, finding.title).toBeGreaterThan(0);

    const [reported, billed] = readme(/the KPI pack reports ([A-Z]{3} [0-9,]+); `invoice-lines\.csv` supports ([A-Z]{3} [0-9,]+)/);
    const arr = byTitle['Management ARR exceeds billed ARR'];
    expect(arr).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(arr?.description).toContain(`Management reports ARR of ${reported}; billing supports ${billed} at September 2026`);
    expect(arr?.description).toContain('Quarry Lane Studios (synthetic), last billed June 2026');

    const [top, share] = readme(/\*\*Revenue concentration\*\* — (.+?) is ([0-9.]+%) of September 2026/);
    expect(byTitle['Revenue concentration']?.description).toContain(`${top} is ${share} of September 2026 revenue`);

    const clause = byTitle['Customer can terminate on change of control'];
    expect(clause).toMatchObject({ domain: 'LEGAL', direction: 0 });
    expect(clause?.evidence.find((link) => link.documentCitation)?.documentCitation?.pageNumber).toBe(2);

    const contraction = byTitle['Contraction hidden in the logo count'];
    expect(contraction?.description).toContain('Amberline Hotels (synthetic) pays');
    expect(contraction?.description).toContain('30.0% below');
    expect(contraction?.description).toContain('Management reports 14 active customers; billing has 13 in September 2026');
  });

  it('is refused to another tenant', async () => {
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
