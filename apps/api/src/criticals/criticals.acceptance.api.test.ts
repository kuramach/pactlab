import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoModelResponse } from '../demo-seed/seed';
import { pdfOf, startAcceptanceDeal, type AcceptanceDeal, type Body } from '../packs/acceptance-kit';

const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
type Figure = { period: string | null; value: string | null; display: string | null; outcome: string; source: string; citation: { documentId: string; pageNumber: number; quote: string } | null };
type Row = {
  key: string;
  origin: 'ORG' | 'PACT';
  words: string | null;
  state: string;
  structureText: string | null;
  standard: { structureText: string | null } | null;
  override: { reason: string; structureText: string | null } | null;
  evaluation: { rating: string; rationale: string; missing: string | null; requests: string | null; policyBreach: boolean; findingId: string | null; figures: Figure[]; formula: string | null; evidenceIds: string[]; stale: boolean; olderVersion: boolean; ratedVersion: number } | null;
};
type Panel = { rows: Row[]; summary: { policyBreaches: number; stale: boolean } };
type Finding = { id: string; title: string; direction: number | null; status: string; valueConfirmation: { valueDriver: string } | null; evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[] };

/**
 * T-179 acceptance: Deal Criticals on the multifamily demo (pactlab-demo-data/multifamily/USD).
 * The org writes its red lines in words, the (scripted) AI proposes the structure, a person confirms
 * it; the pact rates each from recomputed figures or cited pages: Good, Even, Bad or No evidence.
 */
describe('Deal Criticals', { timeout: 120_000 }, () => {
  let deal: AcceptanceDeal;
  const url = (path = '') => `/v1/deals/${deal.dealId}/criticals${path}`;
  const panel = async (dealId = deal.dealId, who = 'lead') => (await deal.call('GET', `/v1/deals/${dealId}/criticals`, who)).body as unknown as Panel;
  const row = (view: Panel, words: string) => view.rows.find((entry) => entry.words === words);
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as Finding[];
  const standard = async (words: string, companyType = 'MULTIFAMILY') => {
    const created = await deal.call('POST', '/v1/criticals', 'lead', { companyType, words });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body as Body & { key: string; version: number; structure: Body | null; evaluates: boolean };
  };
  const confirm = async (key: string, version: number, structure: Body) => {
    const confirmed = await deal.call('POST', `/v1/criticals/${key}/confirm`, 'lead', { version, structure });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    return confirmed.body;
  };
  const evaluate = async (dealId = deal.dealId) => {
    const run = await deal.call('POST', `/v1/deals/${dealId}/criticals/evaluate`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    return run.body as Body & { panel: Panel; skipped: unknown[] };
  };
  const CAP = 'Cap rate must be at least 6%';
  const OCCUPANCY = 'Occupancy at or above 90% in each of the last 3 years';
  let capKey = '';
  let secondDealId = '';

  beforeAll(async () => {
    deal = await startAcceptanceDeal('MULTIFAMILY', 'USD', {
      dataClasses: { '01-offering-memorandum.md': 'FINANCIAL' },
      gateway: new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } }),
    });
    const asking = await deal.call('POST', `/v1/deals/${deal.dealId}/asking-price`, 'lead', { amount: '21000000', currency: 'USD', basis: 'ENTERPRISE_VALUE', source: 'TEASER' });
    expect(asking.status, JSON.stringify(asking.body)).toBe(201);
  }, 180_000);
  afterAll(async () => deal?.close());

  it('words become a proposed structure that evaluates nothing until a person confirms it', async () => {
    const cap = await standard(CAP);
    capKey = cap.key;
    expect(cap).toMatchObject({ state: 'PROPOSED', evaluates: false, structureSource: 'AI', structure: { metric: 'CAP_RATE', comparator: 'AT_LEAST', threshold: '0.06', lookbackYears: null } });
    // Unconfirmed: inert. The panel lists nothing to rate and evaluation rates nothing.
    const before = await evaluate();
    expect(before['rated']).toBe(0);
    expect(row(before.panel, CAP)).toBeUndefined();
    const confirmed = await confirm(cap.key, cap.version, cap.structure ?? {});
    expect(confirmed).toMatchObject({ state: 'CONFIRMED', evaluates: true, version: 2, structureSource: 'AI', structureText: 'Cap rate ≥ 6.00%' });
    // Only org admins change the library; a stale version is refused.
    expect((await deal.call('POST', `/v1/criticals/${cap.key}/confirm`, 'lead', { version: 1, structure: cap.structure })).status).toBe(409);
    expect((await deal.call('POST', '/v1/criticals', 'reviewer', { companyType: 'MULTIFAMILY', words: CAP })).status).toBe(403);
    // A structure must target a metric the type can evidence.
    const saas = await standard('Cap rate at least 6%', 'SOFTWARE_SAAS');
    expect((await deal.call('POST', `/v1/criticals/${saas.key}/confirm`, 'lead', { version: saas.version, structure: saas.structure })).body).toMatchObject({ code: 'STRUCTURE_INVALID' });
  });

  it('rates cap rate from the recomputed NOI and the asking price, and the occupancy trend Bad from each year’s figures', async () => {
    const occupancy = await standard(OCCUPANCY);
    expect(occupancy.structure).toMatchObject({ metric: 'OCCUPANCY', threshold: '0.9', lookbackYears: 3 });
    await confirm(occupancy.key, occupancy.version, occupancy.structure ?? {});
    const view = (await evaluate()).panel;

    const cap = row(view, CAP);
    expect(cap?.origin).toBe('ORG');
    expect(cap?.evaluation?.figures).toHaveLength(1);
    expect(cap?.evaluation?.formula).toContain('USD 21000000');
    // NOI from the FY2026 statements ÷ USD 21,000,000, below 6%: a breach of the firm's red line, with the rows one click away.
    expect(Number(cap?.evaluation?.figures[0]?.value)).toBeLessThan(0.06);
    expect(cap?.evaluation).toMatchObject({ rating: 'BAD', policyBreach: true });
    expect(cap?.evaluation?.evidenceIds.length).toBeGreaterThan(0);

    const occ = row(view, OCCUPANCY);
    expect(occ?.evaluation?.rating).toBe('BAD');
    expect(occ?.evaluation?.figures.map((figure) => [figure.period, figure.display, figure.outcome])).toEqual([
      ['FY2024', '93.14%', 'MET'],
      ['FY2025', '91.15%', 'MET'],
      ['FY2026', '88.54%', 'MISSED'],
    ]);
    expect(view.summary.policyBreaches).toBe(2);

    // Bad → a −1 draft finding citing the very rows; nothing accepted or priced on its own.
    const all = await findings();
    const breach = all.find((finding) => finding.id === occ?.evaluation?.findingId);
    expect(breach).toMatchObject({ direction: -1, status: 'DRAFT', title: `Policy breach: ${OCCUPANCY}` });
    expect(breach?.evidence.every((link) => link.evidenceItemId !== null)).toBe(true);
    // Re-evaluating the same evidence raises nothing new.
    const count = all.length;
    await evaluate();
    expect((await findings()).length).toBe(count);
  });

  it('a Bad critical flows into the bridge like any drag; a Good one is confirmed value only', async () => {
    // A Good critical: occupancy's low point above 80% in each of the last 2 years (a pact critical, person-entered).
    const good = await deal.call('POST', url(), 'lead', { words: 'Lowest occupancy at least 80% in each of the last 2 years', structure: { metric: 'OCCUPANCY_LOW', comparator: 'AT_LEAST', threshold: '0.8', lookbackYears: 2, evenBand: null } });
    expect(good.status, JSON.stringify(good.body)).toBe(201);
    await deal.call('POST', url(`/${good.body['key'] as string}/confirm`), 'lead', { version: 1, structure: good.body['structure'] });
    const view = (await evaluate()).panel;
    const met = view.rows.find((entry) => entry.key === good.body['key']);
    expect(met?.evaluation).toMatchObject({ rating: 'GOOD', policyBreach: false });
    const all = await findings();
    const cushion = all.find((finding) => finding.id === met?.evaluation?.findingId);
    expect(cushion).toMatchObject({ direction: 1 });
    expect(cushion?.valueConfirmation?.valueDriver).toContain('Deal critical');
    const drag = all.find((finding) => finding.id === row(view, OCCUPANCY)?.evaluation?.findingId);
    // A person prices the drag; the critical never prices itself.
    const priced = await deal.call('PATCH', `/v1/deals/${deal.dealId}/findings/${drag?.id ?? ''}`, 'lead', { expectedVersion: 1, pricedRisk: { type: 'PRICE_REDUCTION', low: '250000', high: '500000', currency: 'USD', basis: 'Occupancy below the floor (synthetic)' } });
    expect(priced.status, JSON.stringify(priced.body)).toBe(200);
    const reviewed = async (id: string) => {
      const current = ((await deal.call('GET', `/v1/deals/${deal.dealId}/findings/${id}`, 'lead')).body as { finding: { version: number } }).finding;
      const submitted = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'lead', { expectedVersion: current.version, decision: 'SUBMITTED', rationale: 'Checked against the rows' });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
      const accepted = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'reviewer', { expectedVersion: current.version + 1, decision: 'ACCEPTED', rationale: 'Confirmed' });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    };
    await reviewed(drag?.id ?? '');
    await reviewed(cushion?.id ?? '');
    const scenarios = `/v1/deals/${deal.dealId}/valuation/scenarios`;
    const created = await deal.call('POST', scenarios, 'lead', {
      name: 'NOI at a 5.5% cap rate',
      values: { assumptions: { method: 'NOI_CAP_RATE', noi: '990000', capRate: '0.055' }, bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' }, findingLinks: [{ findingId: drag?.id, point: 'HIGH' }] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const ran = await deal.call('POST', `${scenarios}/${(created.body['scenario'] as { id: string }).id}/runs`, 'lead', { expectedVersion: 1 });
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    const result = (ran.body['latestRun'] as { result: { bridge: { lines: { kind: string; findingId?: string; amount: { amount: string } }[] } } }).result;
    expect(result.bridge.lines.find((line) => line.findingId === drag?.id)?.amount.amount).toBe('-500000.00');
    expect(result.bridge.lines.some((line) => line.findingId === cushion?.id)).toBe(false);
    expect((ran.body['confirmedValue'] as { items: { findingId: string }[] }).items.map((item) => item.findingId)).toContain(cushion?.id);
  });

  it('a text metric is rated from a cited page; one the pact cannot evidence reads No evidence and names the document', async () => {
    const loan = await deal.call('POST', `/v1/deals/${deal.dealId}/documents`, 'lead', {
      fileName: 'loan-term-sheet.pdf',
      contentType: 'application/pdf',
      contentBase64: pdfOf('Senior loan term sheet (synthetic)\nThe debt service coverage ratio at closing is 1.35x on in-place NOI.').toString('base64'),
      dataClass: 'FINANCIAL',
    });
    expect(loan.status, JSON.stringify(loan.body)).toBe(201);
    const dscr = await deal.call('POST', url(), 'lead', { words: 'DSCR at least 1.25x' });
    expect(dscr.body['structure']).toMatchObject({ metric: 'DSCR', threshold: '1.25' });
    await deal.call('POST', url(`/${dscr.body['key'] as string}/confirm`), 'lead', { version: 1, structure: dscr.body['structure'] });
    const anchor = await deal.call('POST', url(), 'lead', { words: 'Anchor-tenant lease has at least 5 years remaining' });
    expect(anchor.body['structure']).toMatchObject({ metric: 'ANCHOR_LEASE_YEARS', threshold: '5' });
    await deal.call('POST', url(`/${anchor.body['key'] as string}/confirm`), 'lead', { version: 1, structure: anchor.body['structure'] });

    const view = (await evaluate()).panel;
    const text = view.rows.find((entry) => entry.key === dscr.body['key']);
    expect(text?.evaluation).toMatchObject({ rating: 'GOOD' });
    expect(text?.evaluation?.figures[0]).toMatchObject({ value: '1.35', source: 'DOCUMENT', citation: { documentId: loan.body['id'], pageNumber: 1 } });
    expect(text?.evaluation?.figures[0]?.citation?.quote).toContain('1.35x');
    const none = view.rows.find((entry) => entry.key === anchor.body['key']);
    expect(none?.evaluation?.rating).toBe('NO_EVIDENCE');
    expect(none?.evaluation?.missing).toContain('anchor tenant’s lease');
    expect(none?.evaluation?.requests).toBe('LEASE');
    expect(none?.evaluation?.findingId).toBeNull();
    // Pact criticals are This pact; a Bad on one is never a policy breach.
    expect(none?.origin).toBe('PACT');
  });

  it('new documents mark ratings stale, never re-run them; the seller sees no criticals surface', async () => {
    await deal.call('POST', `/v1/deals/${deal.dealId}/documents`, 'lead', { fileName: 'note.pdf', contentType: 'application/pdf', contentBase64: pdfOf('A later note (synthetic)').toString('base64'), dataClass: 'BUSINESS' });
    const view = await panel();
    expect(row(view, CAP)?.evaluation?.stale).toBe(true);
    expect(view.summary.stale).toBe(true);
    // The wall: the seller, and another organization, see nothing.
    expect((await deal.call('GET', url(), 'target_contributor')).status).toBe(403);
    expect((await deal.call('POST', url('/evaluate'), 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', '/v1/criticals', 'target_contributor')).body['items']).toEqual([]);
    expect((await deal.call('GET', url(), 'other')).status).toBe(404);
    const rows = await deal.ownerQuery(`SELECT count(*)::int AS n FROM critical_evaluations WHERE deal_id = $1`, [deal.dealId]);
    expect(Number(rows.rows[0]?.['n'])).toBeGreaterThan(0);
  });

  it('an override (6% → 5.5%, with a reason) rates this pact against 5.5%; another pact still rates against the org’s 6%', async () => {
    const reasonless = await deal.call('POST', url('/overrides'), 'lead', { standardKey: capKey, structure: { metric: 'CAP_RATE', comparator: 'AT_LEAST', threshold: '0.055', lookbackYears: null, evenBand: null } });
    expect(reasonless.status).toBe(400);
    expect((await deal.call('POST', url('/overrides'), 'reviewer', { standardKey: capKey, structure: null, disabled: true, reason: 'Not for this deal' })).status).toBe(403);
    const overridden = await deal.call('POST', url('/overrides'), 'lead', { standardKey: capKey, structure: { metric: 'CAP_RATE', comparator: 'AT_LEAST', threshold: '0.055', lookbackYears: null, evenBand: null }, reason: 'Value-add plan lifts NOI in year two (synthetic)' });
    expect(overridden.status, JSON.stringify(overridden.body)).toBe(201);
    const view = (await evaluate()).panel;
    const cap = row(view, CAP);
    expect(cap?.structureText).toBe('Cap rate ≥ 5.50%');
    expect(cap?.standard?.structureText).toBe('Cap rate ≥ 6.00%');
    expect(cap?.override?.reason).toBe('Value-add plan lifts NOI in year two (synthetic)');

    // A second multifamily pact of the same organization: the org standard as written.
    const pact = await deal.call('POST', '/v1/pacts', 'lead', { name: 'Project Second', baseCurrency: 'USD', buyer: { name: 'Alpha Capital', ownership: 'PRIVATE' }, seller: { name: 'Second Multifamily (synthetic)', ownership: 'PRIVATE', companyType: 'MULTIFAMILY' } });
    expect(pact.status).toBe(201);
    secondDealId = pact.body['id'] as string;
    const t12 = await deal.upload(`/v1/deals/${secondDealId}/uploads?target=MULTIFAMILY_T12&system=pactlab_standard&fileName=t12.csv`, 'lead', readFileSync(join(deal.folder, 't12.csv'), 'utf8'));
    expect((await deal.call('POST', `/v1/deals/${secondDealId}/uploads/${t12.body['id'] as string}/import`, 'lead', { mapping: t12.body['suggestedMapping'] })).status).toBe(200);
    await deal.call('POST', `/v1/deals/${secondDealId}/asking-price`, 'lead', { amount: '15000000', currency: 'USD', basis: 'ENTERPRISE_VALUE', source: 'TEASER' });
    const second = (await evaluate(secondDealId)).panel;
    const standardRow = second.rows.find((entry) => entry.key === capKey);
    expect(standardRow?.structureText).toBe('Cap rate ≥ 6.00%');
    expect(standardRow?.override).toBeNull();
    expect(standardRow?.evaluation?.rating).toMatch(/GOOD|BAD|EVEN/);
    // Pact criticals never leak into another pact.
    expect(second.rows.every((entry) => entry.origin === 'ORG')).toBe(true);
  });

  it('editing an org critical is a new version; a pact rated before shows it was rated under the older one; promotion carries the structure', async () => {
    const before = await panel(secondDealId);
    const cap = before.rows.find((entry) => entry.key === capKey);
    const edited = await deal.call('PUT', `/v1/criticals/${capKey}`, 'lead', { version: 2, words: 'Cap rate must be at least 6.5%' });
    expect(edited.body).toMatchObject({ version: 3, state: 'PROPOSED' });
    await confirm(capKey, 3, edited.body['structure'] as Body);
    const after = (await panel(secondDealId)).rows.find((entry) => entry.key === capKey);
    expect(after?.structureText).toBe('Cap rate ≥ 6.50%');
    expect(after?.evaluation).toMatchObject({ olderVersion: true, ratedVersion: cap?.evaluation?.ratedVersion });

    const pactOnly = (await panel()).rows.find((entry) => entry.origin === 'PACT' && entry.evaluation?.rating === 'GOOD' && entry.words?.startsWith('DSCR'));
    const promoted = await deal.call('POST', url(`/${pactOnly?.key ?? ''}/promote`), 'lead');
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(201);
    expect(promoted.body).toMatchObject({ scope: 'ORG', state: 'CONFIRMED', companyType: 'MULTIFAMILY', structureText: 'Debt service coverage ratio ≥ 1.25x', promotedFromKey: pactOnly?.key });
    const library = (await deal.call('GET', '/v1/criticals?companyType=MULTIFAMILY', 'lead')).body as { items: { key: string }[]; total: number };
    expect(library.items.map((item) => item.key)).toContain(promoted.body['key']);
  });
});
