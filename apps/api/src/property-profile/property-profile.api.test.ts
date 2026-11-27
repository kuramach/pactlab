import { FixturePhotoProvider, FixturePropertyRecordProvider } from '@pactlab/connectors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAcceptanceDeal, type AcceptanceDeal } from '../packs/acceptance-kit';

type Field = { key: string; value: string; status: string; provenance: { source: string; label: string; recordId: string; fetchedAt: string } };
type Accepted = { value: string; basis: string; provenance: unknown };
type View = {
  address: string | null;
  status: string;
  metadata: { offered: boolean; note: string | null };
  photos: { items: { index: number; kind: string; source: string; capturedOn: string | null; attribution: string | null; ref?: string }[] };
  proposed: Field[];
  accepted: Record<string, Accepted>;
  contradictions: { key: string; statement: string; rationale: string }[];
  referenceLabel: string;
};

/**
 * T-188 fixture API test: a multifamily pact's property profile is populated from the address (US only), reviewed and
 * accepted with per-field provenance; the Texas record shows its sale price as not published and a sparse record
 * shows "not in public record"; photos come with source, date and attribution; a rent roll that contradicts an
 * accepted value raises a claim and changes neither side. CI never calls RentCast or Google: fixtures answer.
 */
describe('multifamily property profile (T-188)', { timeout: 120_000 }, () => {
  let deal: AcceptanceDeal;
  const records = new FixturePropertyRecordProvider();
  const base = () => `/v1/deals/${deal.dealId}/property-profile`;
  const view = async (who = 'lead') => (await deal.call('GET', base(), who)).body as unknown as View;
  const field = (v: View, key: string) => v.proposed.find((f) => f.key === key);
  const audits = async (action: string, outcome: string) => Number((await deal.ownerQuery(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = $2 AND outcome = $3`, [deal.dealId, action, outcome])).rows[0]?.['n']);

  beforeAll(async () => {
    deal = await startAcceptanceDeal('MULTIFAMILY', 'USD', { propertyRecords: records, propertyPhotos: new FixturePhotoProvider() });
  }, 120_000);
  afterAll(async () => deal?.close());

  it('starts empty, asks for the address, and gives a non-US address the explanation with no lookup', async () => {
    const empty = await view();
    expect(empty).toMatchObject({ address: null, status: 'EMPTY', proposed: [], referenceLabel: 'Third-party reference data' });
    expect((await deal.call('POST', `${base()}/populate`, 'lead', {})).body['code']).toBe('PROPERTY_ADDRESS_NEEDED');
    const abroad = await deal.call('POST', `${base()}/populate`, 'lead', { address: '12 Harbour Road, Leeds LS1 4AB, United Kingdom' });
    expect(abroad.status).toBe(422);
    expect(abroad.body).toMatchObject({ code: 'METADATA_US_ONLY' });
    expect(records.requests).toEqual([]);
  });

  it('a Texas record shows its sale price as not published; a sparse one shows missing fields as not in public record', async () => {
    const texas = await deal.call('POST', `${base()}/populate`, 'lead', { address: '500 Example Ave, Austin, TX 78701' });
    expect(texas.status, JSON.stringify(texas.body)).toBe(200);
    const t = texas.body as unknown as View;
    expect(field(t, 'last_sale')).toMatchObject({ value: 'sale price not published (non-disclosure state)', status: 'NOT_PUBLISHED_NON_DISCLOSURE' });
    expect(field(t, 'unit_count')?.value).toBe('60');

    const sparse = (await deal.call('POST', `${base()}/populate`, 'lead', { address: '77 Thin Record Rd, Smallville, IA 50010' })).body as unknown as View;
    expect(field(sparse, 'year_built')).toMatchObject({ value: '1962', status: 'PRESENT' });
    for (const key of ['living_area', 'unit_count', 'tax_assessments', 'last_sale']) expect(field(sparse, key), key).toMatchObject({ value: 'not in public record', status: 'NOT_IN_PUBLIC_RECORD' });
    expect(sparse.address).toBe('77 Thin Record Rd, Smallville, IA 50010');
  });

  it('proposes the full record with per-field provenance; nothing is pact data until accepted', async () => {
    const full = (await deal.call('POST', `${base()}/populate`, 'lead', { address: '1200 Sample St, Columbus, OH 43215' })).body as unknown as View;
    expect(full.status).toBe('PROPOSED');
    expect(field(full, 'last_sale')?.value).toBe('USD 6,200,000 (2019-05-14)');
    expect(full.proposed.every((f) => f.provenance.source === 'RentCast public record' && f.provenance.label === 'Third-party reference data' && f.provenance.recordId && f.provenance.fetchedAt)).toBe(true);
    expect(full.accepted).toEqual({});
  });

  it('accepts what the reviewer kept or edited; absence is never accepted as a value', async () => {
    expect((await deal.call('POST', `${base()}/accept`, 'lead', { values: [{ key: 'year_built', value: 'not in public record' }] })).status).toBe(422);
    expect((await deal.call('POST', `${base()}/accept`, 'lead', { values: [{ key: 'bogus', value: 'x' }] })).status).toBe(400);
    const accepted = await deal.call('POST', `${base()}/accept`, 'lead', { values: [{ key: 'year_built', value: '1987' }, { key: 'property_type', value: 'Garden apartments' }, { key: 'unit_count', value: '48' }, { key: 'living_area', value: '42,500 sq ft' }] });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const v = accepted.body as unknown as View;
    expect(v.status).toBe('ACCEPTED');
    expect(v.accepted['year_built']).toMatchObject({ value: '1987', basis: 'RECORD' });
    expect(v.accepted['year_built']?.provenance).toMatchObject({ source: 'RentCast public record', label: 'Third-party reference data' });
    expect(v.accepted['property_type']).toMatchObject({ value: 'Garden apartments', basis: 'EDITED' });
    expect(await audits('property_profile.accepted', 'SUCCEEDED')).toBe(1);
  });

  it('a rent roll that contradicts an accepted value raises a claim and overwrites neither side', async () => {
    const units = Number((await deal.ownerQuery(`SELECT count(*)::int AS n FROM evidence_items WHERE deal_id = $1 AND evidence_type = 'multifamily.unit'`, [deal.dealId])).rows[0]?.['n']);
    expect(units).toBeGreaterThan(0);
    const unitCount = units === 48 ? '47' : '48';
    const result = await deal.call('POST', `${base()}/accept`, 'lead', { values: [{ key: 'unit_count', value: unitCount }] });
    const v = result.body as unknown as View;
    expect(v.accepted['unit_count']?.value).toBe(unitCount);
    expect(v.contradictions.map((c) => c.key)).toContain('unit_count');
    const claims = await deal.ownerQuery(`SELECT status, origin, rationale, array_length(evidence_item_ids, 1) AS cited FROM deal_claims WHERE deal_id = $1 AND statement LIKE '%property profile%lists ${unitCount} units'`, [deal.dealId]);
    expect(claims.rows).toHaveLength(1);
    expect(claims.rows[0]).toMatchObject({ status: 'CONTRADICTED', origin: 'PACK_RULE' });
    expect(String(claims.rows[0]?.['rationale'])).toContain(`rent roll lists ${units} units`);
    expect(Number(claims.rows[0]?.['cited'])).toBeGreaterThan(0);
    // The rent roll is untouched, and a second check adds no duplicate.
    expect(Number((await deal.ownerQuery(`SELECT count(*)::int AS n FROM evidence_items WHERE deal_id = $1 AND evidence_type = 'multifamily.unit'`, [deal.dealId])).rows[0]?.['n'])).toBe(units);
    const again = await deal.call('POST', `${base()}/check`, 'lead');
    expect(again.body['claims']).toBe(0);
  });

  it('shows the gallery with source, capture date and attribution, and streams bytes without a key', async () => {
    const found = (await deal.call('POST', `${base()}/photos`, 'lead')).body as unknown as View;
    expect(found.photos.items.map((p) => p.kind)).toEqual(['STREET_VIEW', 'PLACES', 'PLACES']);
    expect(found.photos.items[0]).toMatchObject({ source: 'Google Street View', capturedOn: '2024-06', attribution: null });
    expect(found.photos.items[1]).toMatchObject({ source: 'Google Maps', attribution: 'Synthetic Photographer' });
    // References never reach the browser.
    expect(JSON.stringify(found)).not.toContain('FIXTURE_PANO');
    const image = await deal.app.inject({ method: 'GET', url: `${base()}/photos/0/image`, headers: { authorization: (await authHeader()) } });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/svg+xml');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect((await deal.app.inject({ method: 'GET', url: `${base()}/photos/9/image`, headers: { authorization: (await authHeader()) } })).statusCode).toBe(404);
    expect(await audits('property_profile.photos_fetched', 'SUCCEEDED')).toBe(1);
  });

  it('is refused to a counterparty (403) and invisible to another tenant (404); reads and provider calls are audited', async () => {
    const accept = { values: [{ key: 'year_built', value: '1' }] };
    for (const [method, url, payload] of [['GET', base(), undefined], ['POST', `${base()}/populate`, {}], ['POST', `${base()}/accept`, accept], ['POST', `${base()}/photos`, undefined]] as const) {
      expect((await deal.call(method, url, 'target_contributor', payload)).status, url).toBe(403);
      expect((await deal.call(method, url, 'other', payload)).status, url).toBe(404);
    }
    expect(await audits('property_profile.viewed', 'SUCCEEDED')).toBeGreaterThan(0);
    expect(await audits('property_profile.record_fetched', 'SUCCEEDED')).toBe(3);
    expect(await audits('property_profile.viewed', 'DENIED')).toBe(1);
  });

  async function authHeader() {
    return deal.bearer('lead');
  }
});
