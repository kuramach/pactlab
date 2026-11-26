import { FixtureMarketRentProvider } from '@pactlab/connectors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAcceptanceDeal, type AcceptanceDeal } from '../packs/acceptance-kit';

type Metric = { key: string; label: string; value: string | null; needs?: string[]; source?: string; evidenceIds?: string[]; formula: string; sourceCount: number };
type FloorPlan = { key: string; units: number; overCap: boolean; estimate: { evidenceId: string; rent: string; source: string; retrievedOn: string } | null };
type Finding = { title: string; status: string; direction: number | null; evidence: { evidenceItemId: string | null }[] };

/**
 * T-158 fixture API test: a multifamily pact's rent roll (the public demo data) → market rents retrieved
 * (one call per floor plan, capped) → market rent and loss-to-lease vs market, cited → the below-range
 * finding drafted. CI never calls RentCast: the fixture provider answers and counts the calls.
 */
describe('market rents for a rent roll (T-158)', { timeout: 60_000 }, () => {
  let deal: AcceptanceDeal;
  const provider = new FixtureMarketRentProvider();
  const base = () => `/v1/deals/${deal.dealId}/market-rents`;
  const metrics = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body['metrics'] as Metric[];
  const estimateRows = async () => Number((await deal.ownerQuery(`SELECT count(*)::int AS n FROM evidence_items WHERE deal_id = $1 AND evidence_type = 'market.rent_estimate'`, [deal.dealId])).rows[0]?.['n']);

  beforeAll(async () => {
    deal = await startAcceptanceDeal('MULTIFAMILY', 'USD', { marketRents: provider });
  }, 120_000);
  afterAll(async () => deal?.close());

  it('before retrieval: the market figures are missing and ask for the retrieval, not the seller', async () => {
    const byKey = Object.fromEntries((await metrics()).map((metric) => [metric.key, metric]));
    expect(byKey['market_rent_annual']).toMatchObject({ value: null, needs: ['MARKET_RENTS'] });
    expect(byKey['loss_to_lease_market']).toMatchObject({ value: null, needs: ['MARKET_RENTS'] });
    // The rent roll's own loss-to-lease stays, labelled apart.
    expect(byKey['loss_to_lease']).toMatchObject({ label: 'Loss-to-lease (from the rent roll)', source: 'Rent roll' });
    expect(byKey['loss_to_lease']?.value).not.toBeNull();
  });

  it('asks once for the address when no listing names it, and stores it on the pact, audited', async () => {
    const status = await deal.call('GET', base(), 'lead');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ available: true, address: null, addressFrom: null, currencySupported: true, callsPerRetrieval: 10 });
    expect((status.body['floorPlans'] as FloorPlan[]).map((plan) => plan.key).sort()).toEqual(['1BR', '2BR', '3BR']);
    const refused = await deal.call('POST', `${base()}/retrieve`, 'lead');
    expect(refused.status).toBe(422);
    expect(refused.body['code']).toBe('PROPERTY_ADDRESS_NEEDED');
    expect(provider.requests).toHaveLength(0);

    expect((await deal.call('PUT', `${base()}/address`, 'lead', { address: 'x' })).status).toBe(400);
    const saved = await deal.call('PUT', `${base()}/address`, 'lead', { address: '5500 Grand Lake Dr, San Antonio, TX 78244' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ address: '5500 Grand Lake Dr, San Antonio, TX 78244', addressFrom: 'PACT' });
    const audit = await deal.ownerQuery(`SELECT outcome FROM audit_events WHERE deal_id = $1 AND action = 'deal.property_address_set'`, [deal.dealId]);
    expect(audit.rows.map((row) => row['outcome'])).toEqual(['SUCCEEDED']);
  });

  it('retrieves one estimate per floor plan, as evidence, and drafts the below-range finding', async () => {
    const run = await deal.call('POST', `${base()}/retrieve`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body['retrieval']).toMatchObject({ calls: 3, created: 3, unchanged: 0, noEstimate: [], overCap: [] });
    expect(provider.requests.map((request) => [request.bedrooms, request.propertyType, request.compCount, request.address])).toEqual(
      expect.arrayContaining([[1, 'Apartment', 15, '5500 Grand Lake Dr, San Antonio, TX 78244'], [2, 'Apartment', 15, '5500 Grand Lake Dr, San Antonio, TX 78244'], [3, 'Apartment', 15, '5500 Grand Lake Dr, San Antonio, TX 78244']]),
    );
    const plans = run.body['floorPlans'] as FloorPlan[];
    expect(plans.every((plan) => plan.estimate?.source === 'RentCast (fixture, synthetic)' && plan.estimate.retrievedOn === new Date().toISOString().slice(0, 10))).toBe(true);
    expect(await estimateRows()).toBe(3);

    // Each estimate resolves to its source record (the citation view).
    const evidenceId = plans[0]?.estimate?.evidenceId ?? '';
    const item = await deal.call('GET', `/v1/deals/${deal.dealId}/evidence/${evidenceId}`, 'lead');
    expect(item.status, JSON.stringify(item.body)).toBe(200);
    expect(JSON.stringify(item.body)).toContain('market.rent_estimate');

    const byKey = Object.fromEntries((await metrics()).map((metric) => [metric.key, metric]));
    const annual = byKey['market_rent_annual'];
    const vsMarket = byKey['loss_to_lease_market'];
    expect(annual?.value).toMatch(/^\d+\.\d{2}$/);
    expect(vsMarket?.value).toMatch(/^0\.\d{4}$/);
    for (const metric of [annual, vsMarket]) {
      expect(metric).toMatchObject({ source: 'RentCast', label: expect.stringContaining('(from RentCast)') });
      expect([...(metric?.evidenceIds ?? [])].sort()).toEqual(plans.map((plan) => plan.estimate?.evidenceId).sort());
      expect(metric?.sourceCount).toBeGreaterThan(3);
      expect(metric?.formula).toMatch(/\d+ of \d+ occupied units have an estimate/);
    }

    const findings = (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as Finding[];
    const below = findings.find((finding) => finding.title === 'In-place rents below the market range (RentCast)');
    expect(below).toMatchObject({ status: 'DRAFT', direction: 1 });
    const cited = new Set(below?.evidence.map((link) => link.evidenceItemId));
    for (const plan of plans) expect(cited.has(plan.estimate?.evidenceId ?? '')).toBe(true);
    expect(cited.size).toBeGreaterThan(plans.length); // and the rent-roll rows

    const audit = await deal.ownerQuery(`SELECT outcome FROM audit_events WHERE deal_id = $1 AND action = 'market_rents.retrieved'`, [deal.dealId]);
    expect(audit.rows.map((row) => row['outcome'])).toEqual(['SUCCEEDED']);
  });

  it('a re-run within the day calls nothing and adds nothing', async () => {
    const calls = provider.requests.length;
    const again = await deal.call('POST', `${base()}/retrieve`, 'lead');
    expect(again.status).toBe(200);
    expect(again.body['retrieval']).toMatchObject({ calls: 0, created: 0 });
    expect(provider.requests).toHaveLength(calls);
    expect(await estimateRows()).toBe(3);
    const findings = (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as Finding[];
    expect(findings.filter((finding) => finding.title === 'In-place rents below the market range (RentCast)')).toHaveLength(1);
  });

  it('is refused to a counterparty (403) and invisible to another tenant (404)', async () => {
    for (const [method, url] of [['GET', base()], ['POST', `${base()}/retrieve`]] as const) {
      expect((await deal.call(method, url, 'target_contributor')).status).toBe(403);
      expect((await deal.call(method, url, 'other')).status).toBe(404);
    }
    expect((await deal.call('PUT', `${base()}/address`, 'target_contributor', { address: '1 Other St, Austin, TX 78701' })).status).toBe(403);
    const denied = await deal.ownerQuery(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'market_rents.retrieved' AND outcome = 'DENIED'`, [deal.dealId]);
    expect(Number(denied.rows[0]?.['n'])).toBe(1);
  });

  it('caps the calls per retrieval: floor plans beyond ten are listed, not checked', async () => {
    // A second rent roll with twelve more floor plans (4 to 15 bedrooms), one unit each.
    const rows = Array.from({ length: 12 }, (_, index) => `Z${index + 1},Z,${index + 4}BR,${1500 + index * 100},occupied,2026-01-01,2026-12-31,2000.00,2100.00,0.00`);
    const csv = ['unit,building,type,sqft,status,lease_start,lease_end,in_place_rent,market_rent,balance_due', ...rows].join('\n');
    const query = new URLSearchParams({ system: 'pactlab_standard', fileName: 'rent-roll-annex.csv', target: 'MULTIFAMILY_RENT_ROLL' });
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?${query.toString()}`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${String(uploaded.body['id'])}/import`, 'lead', { mapping: uploaded.body['suggestedMapping'] });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);

    const calls = provider.requests.length;
    const run = await deal.call('POST', `${base()}/retrieve`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const plans = run.body['floorPlans'] as FloorPlan[];
    expect(plans).toHaveLength(15);
    // The three plans already estimated today are not asked again: seven more fill the cap of ten.
    expect(provider.requests.length - calls).toBe(7);
    expect((run.body['retrieval'] as { overCap: string[] }).overCap).toHaveLength(5);
    expect(plans.filter((plan) => plan.overCap).every((plan) => plan.estimate === null)).toBe(true);
    expect(plans.filter((plan) => !plan.overCap).every((plan) => plan.estimate !== null)).toBe(true);
  });
});
