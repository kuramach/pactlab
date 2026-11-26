import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, startAcceptanceDeal, type AcceptanceDeal, type Body } from './acceptance-kit';

type FindingView = { id: string; title: string; domain: string; direction: number | null; description: string; evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[] };
type SpvView = {
  currency: string;
  guardrail: string;
  round: { check: { preRoundShares: string; conversionShares: string; postRoundShares: { stated: string; recomputed: string; difference: string }; explainedBy: string[]; conversions: { securityId: string; basis: string; proRata: boolean }[] } };
  economics: { commitments: string; feeAmount: string; expenseAmount: string; invested: string; carryRate: string; comparisons: { term: string; agreement: string | null; summary: string | null; matches: boolean | null }[] };
  scenarios: { items: { scenario: string; netMultiple: string; label: string }[]; unavailable: string | null };
  sideLetters: { investorRef: string; effects: { kind: string }[]; disclosed: boolean }[];
  offering: { exemption: string; seats: number; seatsSufficient: number; formD: unknown };
  published: { version: number } | null;
};

const SEATS = [
  { reference: 'INV-01', label: 'Marlowe Family Office (synthetic)', amount: 600000, accreditationStatus: 'THIRD_PARTY_VERIFIED' },
  { reference: 'INV-02', label: 'Pinecrest Angels LLC (synthetic)', amount: 500000, accreditationStatus: 'THIRD_PARTY_VERIFIED' },
  { reference: 'INV-03', label: 'Quayle Partners (synthetic)', amount: 450000, accreditationStatus: 'THIRD_PARTY_VERIFIED' },
  { reference: 'INV-04', label: 'Rowan Okafor (synthetic)', amount: 250000, accreditationStatus: 'SELF_CERTIFIED' },
  { reference: 'INV-05', label: 'Sable Point Capital (synthetic)', amount: 150000, accreditationStatus: 'THIRD_PARTY_VERIFIED' },
] as const;
const SCALE: Readonly<Record<string, string>> = { USD: '1', EUR: '0.92', GBP: '0.79' };
const scaled = (currency: string, amount: number) => (amount * Number(SCALE[currency])).toFixed(2);

/**
 * T-141 acceptance: pactlab-demo-data/startup-spv/<CURRENCY> loaded into a fresh pact runs end to
 * end — round verification, the claims register, the vehicle economics and the published investor
 * view — and every planted defect surfaces: (a) the cap table off by exactly the SAFE conversion,
 * (b) carry 20% in the operating agreement against 15% in the summary, (c) an undisclosed side
 * letter waiving one investor's fee, (d) a 506(c) investor not third-party verified. The wall tests
 * prove the unpublished stays unpublished: investors see their own seat and the published view only;
 * the startup sees no investor.
 */
describe.each(ACCEPTANCE_CURRENCIES)('startup equity SPV pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const seatIds: Record<string, string> = {};
  const url = (path: string) => `/v1/deals/${deal.dealId}${path}`;
  const findings = async () => (await deal.call('GET', url('/findings?limit=100'), 'lead')).body['items'] as FindingView[];
  const view = async () => (await deal.call('GET', url('/spv'), 'lead')).body as unknown as SpvView;

  beforeAll(async () => {
    deal = await startAcceptanceDeal('STARTUP_SPV', currency);
    const saved = await deal.call('PUT', url('/spv/vehicle'), 'lead', { vehicleName: 'Halyard Lumen Seed SPV LLC (synthetic)', downsideMultiple: '0.5', baseMultiple: '3', upsideMultiple: '10' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    for (const seat of SEATS) {
      const added = await deal.call('POST', url('/spv/seats'), 'lead', { label: seat.label, reference: seat.reference, commitment: scaled(currency, seat.amount), accreditationStatus: seat.accreditationStatus });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      seatIds[seat.reference] = added.body['id'] as string;
    }
    await deal.addPerson('investor1', 'INVESTOR', { investorId: seatIds['INV-01'] });
    await deal.addPerson('investor3', 'INVESTOR', { investorId: seatIds['INV-03'] });
  }, 240_000);
  afterAll(async () => deal?.close());

  it('every planted defect surfaces as a cited draft once; a re-run adds nothing', async () => {
    const run = await deal.call('POST', url('/spv/checks'), 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body, JSON.stringify((await findings()).map((finding) => finding.title))).toMatchObject({ unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await deal.call('POST', url('/spv/checks'), 'lead')).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    for (const [, title] of deal.readme.matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)) expect(byTitle[title ?? ''], title).toBeDefined();
    // (a) The post-round share count misses exactly the SAFE conversion.
    const cap = byTitle['Cap table does not add up after the round'];
    expect(cap).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(cap?.description).toContain('exactly what SAFE-1 converts into');
    expect(cap?.evidence.some((link) => link.documentCitation?.quote === 'Fully diluted shares after the round: 11,000,000.')).toBe(true);
    // (b) Carry differs between the operating agreement and the summary: a drag.
    expect(byTitle['Carried interest in the operating agreement differs from the investor summary']).toMatchObject({ domain: 'LEGAL', direction: -1 });
    // (c) The undisclosed side letter: organizer-side, neutral, cited to the letter.
    const letter = byTitle['Side letter grants preferential terms the summary does not disclose'];
    expect(letter).toMatchObject({ direction: 0 });
    expect(letter?.description).toContain('investor INV-03');
    // (d) A 506(c) investor not verified by a third party: by reference, never by name.
    const gap = byTitle['Accreditation gap in a 506(c) vehicle'];
    expect(gap).toMatchObject({ domain: 'REGULATORY', direction: 0 });
    expect(gap?.description).toContain('INV-04 (self certified)');
    expect(gap?.description).not.toContain('Rowan');
  });

  it('the claims register records each round claim as verified, contradicted or unverified', async () => {
    const claims = (await deal.call('GET', url('/claims'), 'lead')).body['items'] as { statement: string; status: string }[];
    const status = (prefix: string) => claims.find((claim) => claim.statement.startsWith(prefix))?.status;
    expect(status('Pre-money valuation:')).toBe('VERIFIED');
    expect(status('ARR:')).toBe('VERIFIED');
    expect(status('Runway:')).toBe('VERIFIED');
    expect(status('Prior round:')).toBe('VERIFIED');
    expect(status('Fully diluted shares after the round:')).toBe('CONTRADICTED');
    expect(status('Net revenue retention:')).toBe('UNVERIFIED');
  });

  it('the SPV tab recomputes the round and the vehicle economics, and labels every scenario', async () => {
    const spv = await view();
    expect(spv.round.check).toMatchObject({ preRoundShares: '8000000', conversionShares: '400000', postRoundShares: { stated: '11000000', recomputed: '11400000', difference: '400000' }, explainedBy: ['SAFE-1'] });
    expect(spv.round.check.conversions).toEqual([expect.objectContaining({ securityId: 'SAFE-1', basis: 'CAP', proRata: true })]);
    // Commitments are the seats plus the organizer's own; the fee and expenses come off before investing.
    const commitments = SEATS.reduce((sum, seat) => sum + Number(scaled(currency, seat.amount)), 0) + Number(scaled(currency, 50000));
    expect(Number(spv.economics.commitments)).toBeCloseTo(commitments, 2);
    expect(spv.economics).toMatchObject({ carryRate: '0.2', feeAmount: (commitments * 0.02).toFixed(2), expenseAmount: scaled(currency, 25000) });
    expect(spv.economics.comparisons.find((comparison) => comparison.term === 'CARRY')).toMatchObject({ agreement: '20%', summary: '15%', matches: false });
    expect(spv.scenarios.items.map((item) => item.scenario)).toEqual(['DOWNSIDE', 'BASE', 'UPSIDE']);
    expect(spv.scenarios.items.every((item) => item.label.startsWith('Scenario computed from stated assumptions'))).toBe(true);
    expect(spv.sideLetters).toEqual([expect.objectContaining({ investorRef: 'INV-03', disclosed: false })]);
    expect(spv.offering).toMatchObject({ exemption: 'RULE_506C', seats: 5, seatsSufficient: 4 });
    expect(spv.guardrail).toMatch(/no securities-offering, broker-dealer or investment-adviser function/);
    const page = await deal.call('GET', url('/spv/seats?limit=2'), 'lead');
    expect(page.body).toMatchObject({ total: 5, limit: 2 });
    const next = await deal.call('GET', url(`/spv/seats?limit=2&cursor=${String(page.body['nextCursor'])}`), 'lead');
    expect((next.body['items'] as { reference: string }[]).map((seat) => seat.reference)).toEqual(['INV-03', 'INV-04']);
  });

  it('only the deal lead publishes; the frozen snapshot holds the allow-list and nothing organizer-confidential', async () => {
    expect((await deal.call('POST', url('/spv/investor-view/publish'), 'reviewer')).status).toBe(403);
    const published = await deal.call('POST', url('/spv/investor-view/publish'), 'lead');
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    expect(published.body).toMatchObject({ version: 1 });
    const [row] = (await deal.ownerQuery(`SELECT content FROM investor_view_versions WHERE deal_id = $1`, [deal.dealId])).rows;
    const content = row?.['content'] as Body;
    expect(Object.keys(content).sort()).toEqual(['capTable', 'claims', 'economics', 'meta', 'scenarios']);
    const text = JSON.stringify(content);
    // Zero organizer-negotiation and zero other-investor content.
    for (const absent of ['SIDE LETTER', 'waived', 'INV-0', 'Marlowe', 'Pinecrest', 'Quayle', 'Rowan', 'Sable Point', 'Accreditation gap', 'Side letter grants', 'self certified', 'persona', 'brief', ...SEATS.map((seat) => `"${scaled(currency, seat.amount)}"`)]) expect(text, absent).not.toContain(absent);
    expect(text).toContain('Fully diluted shares after the round: 11,000,000.');
    // Final: a correction is a new version.
    await expect(deal.ownerQuery(`UPDATE investor_view_versions SET version = 9 WHERE deal_id = $1`, [deal.dealId])).rejects.toThrow(/final/);
    expect((await deal.call('POST', url('/spv/investor-view/publish'), 'lead')).body).toMatchObject({ version: 2 });
  });

  it('an investor sees their own seat and the published view, and nothing else of the pact', async () => {
    const mine = await deal.call('GET', url('/spv/mine'), 'investor1');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body['seat']).toMatchObject({ reference: 'INV-01', accreditationStatus: 'THIRD_PARTY_VERIFIED' });
    expect((mine.body['view'] as { version: number }).version).toBe(2);
    const text = JSON.stringify(mine.body);
    for (const absent of ['INV-03', 'INV-04', 'Quayle', 'Rowan', 'waived']) expect(text, absent).not.toContain(absent);
    // The organizer's side of the vehicle, the pact's analysis and its material are closed to investors.
    for (const path of ['/spv', '/spv/seats', '/spv/investor-view/preview', '/spv/investor-view/versions', '/findings', '/claims']) expect((await deal.call('GET', url(path), 'investor1')).status, path).toBe(403);
    expect((await deal.call('POST', url('/spv/investor-view/publish'), 'investor1')).status).toBe(403);
    expect((await deal.call('POST', url('/spv/checks'), 'investor1')).status).toBe(403);
    for (const path of ['/documents', '/evidence']) {
      const response = await deal.call('GET', url(path), 'investor1');
      expect([200, 403], path).toContain(response.status);
      if (response.status === 200) expect((response.body['items'] as unknown[]).length, path).toBe(0);
    }
    // Investors never see each other.
    const members = (await deal.call('GET', url('/members'), 'investor1')).body['items'] as { role: string; displayName: string }[];
    expect(members.filter((member) => member.role === 'INVESTOR').map((member) => member.displayName)).toEqual(['investor1 (synthetic)']);
  });

  it('the startup sees the vehicle as one investor: no investor list, no seats, no investor view', async () => {
    for (const path of ['/spv', '/spv/seats', '/spv/mine', '/spv/investor-view/preview', '/spv/investor-view/versions']) expect((await deal.call('GET', url(path), 'target_contributor')).status, path).toBe(403);
    const members = (await deal.call('GET', url('/members'), 'target_contributor')).body['items'] as { role: string }[];
    expect(members.some((member) => member.role === 'INVESTOR')).toBe(false);
    expect((await deal.call('GET', url('/invitations'), 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', url('/spv'), 'other')).status).toBe(404);
    expect((await deal.call('GET', url('/spv/mine'), 'other')).status).toBe(404);
  });

  it('investors are invited to their seat only from the SPV tab', async () => {
    const invited = await deal.call('POST', url(`/spv/seats/${seatIds['INV-02']}/invite`), 'lead', { email: 'Partner@Pinecrest.example' });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const [row] = (await deal.ownerQuery(`SELECT side, role, investor_id FROM deal_invitations WHERE deal_id = $1 AND email = 'partner@pinecrest.example'`, [deal.dealId])).rows;
    expect(row).toEqual({ side: 'INVESTOR', role: 'INVESTOR', investor_id: seatIds['INV-02'] });
    expect((await deal.call('POST', url('/invitations'), 'lead', { email: 'x@y.example', side: 'INVESTOR', role: 'INVESTOR' })).status).toBe(400);
    // Withdrawing a seat removes its people from the pact.
    expect((await deal.call('PATCH', url(`/spv/seats/${seatIds['INV-03']}`), 'lead', { status: 'WITHDRAWN' })).status).toBe(200);
    expect((await deal.call('GET', url('/spv/mine'), 'investor3')).status).toBe(404);
  });
});
