import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadSyntheticManifest } from '@pactlab/db';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Metrics through the real HTTP stack on the synthetic companies: fixture
 * connection → idempotent sync → evidence → deterministic metrics →
 * reconciliation → reviewer approval, with role and tenant denials. Each
 * company is its own synthetic tenant, so cross-company calls are cross-tenant.
 */
describe('SaaS metrics API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let key: CryptoKey;
  let outsider: string;
  let contributor: string;
  let analyst: string;
  let reviewer: string;
  const tenants = {} as Record<'HealthyCo' | 'TroubledCo' | 'SparseCo', SyntheticTenant>;
  const leads = {} as Record<keyof typeof tenants, string>;
  const deals = {} as Record<keyof typeof tenants, string>;
  /** A second TroubledCo deal in the same organization, led by the same user. */
  const twinDealId = newId();

  async function token(subject: string, org: string) {
    return new SignJWT({ org_id: org })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  }

  async function call(method: 'GET' | 'POST', url: string, bearer: string, payload?: Body) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${bearer}` },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Body };
  }

  const summary = (company: keyof typeof deals, bearer = leads[company], query = '') =>
    call('GET', `/v1/deals/${deals[company]}/metrics/summary${query}`, bearer);
  const metric = (body: Body, key: string) =>
    (body['report'].metrics as Body[]).find((m) => m['key'] === key)!;

  async function outboxCount(dealId: string) {
    const result = (await db.owner.query(
      `SELECT event_type, count(*)::int AS n FROM outbox_events WHERE deal_id = $1 AND aggregate_type = 'metrics_reconciliation' GROUP BY event_type ORDER BY event_type`,
      [dealId],
    )) as { rows: { event_type: string; n: number }[] };
    return Object.fromEntries(result.rows.map((row) => [row.event_type, row.n]));
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        keys: createLocalJWKSet({ keys: [jwk] }),
      }),
      logger: createLogger('api-test', { level: 'silent' }),
    });

    const ingest = async (company: keyof typeof tenants, dealId: string) => {
      const manifest = await loadSyntheticManifest(company);
      const connection = await call('POST', `/v1/deals/${dealId}/connections`, leads[company], {
        provider: 'csv',
        displayName: `${company} billing export`,
        mode: 'FIXTURE',
        config: { datasets: manifest.datasets.map((dataset) => dataset.dataset) },
      });
      const sync = await app.inject({
        method: 'POST',
        url: `/v1/deals/${dealId}/sync-runs`,
        headers: {
          authorization: `Bearer ${leads[company]}`,
          'idempotency-key': `metrics-${dealId}`,
        },
        payload: { connectionId: connection.body['id'] },
      });
      expect(sync.json()).toMatchObject({ status: 'SUCCEEDED' });
    };
    for (const company of ['HealthyCo', 'TroubledCo', 'SparseCo'] as const) {
      const tenant = await createSyntheticTenant(db.owner, company);
      tenants[company] = tenant;
      deals[company] = tenant.dealId;
      leads[company] = await token(tenant.subject, tenant.auth0OrganizationId);
      await ingest(company, tenant.dealId);
    }
    const troubled = tenants.TroubledCo;
    await db.owner.query(
      `INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at)
       VALUES ($1, $2, 'Project Twin', 'Twin Target (synthetic)', 'PRIVATE_ACQUIRER', $3, now())`,
      [twinDealId, troubled.organizationId, troubled.userId],
    );
    await db.owner.query(
      `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'DEAL_LEAD')`,
      [newId(), troubled.organizationId, twinDealId, troubled.userId],
    );
    await ingest('TroubledCo', twinDealId);
    const asMember = async (
      company: keyof typeof tenants,
      role: 'ANALYST' | 'REVIEWER' | 'TARGET_CONTRIBUTOR',
    ) => {
      const member = await addSyntheticDealMember(db.owner, tenants[company], role);
      return token(member.subject, tenants[company].auth0OrganizationId);
    };
    analyst = await asMember('TroubledCo', 'ANALYST');
    reviewer = await asMember('TroubledCo', 'REVIEWER');
    contributor = await asMember('HealthyCo', 'TARGET_CONTRIBUTOR');
    outsider = leads.TroubledCo;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('HealthyCo: ledger ARR reconciles exactly to management ARR', async () => {
    const { status, body } = await summary('HealthyCo');
    expect(status).toBe(200);
    expect(body['report']).toMatchObject({
      asOfMonth: '2026-09',
      baseCurrency: 'USD',
      coverageStart: '2025-07',
    });
    expect(metric(body, 'ARR')).toMatchObject({
      value: '402840.00',
      currency: 'USD',
      formula: 'MRR × 12',
    });
    expect(metric(body, 'ACTIVE_CUSTOMERS').value).toBe('6');
    expect(metric(body, 'NRR').value).toBe('1.1201');
    expect(metric(body, 'ARR').inputs.length).toBe(6);
    expect(body['reconciliation']).toMatchObject({
      status: 'RECONCILED',
      calculated: { amount: '402840.00' },
      reported: { value: { amount: '402840.00', currency: 'USD' }, period: '2026-Q3' },
      delta: { amount: '0.00' },
    });
    expect(body['draftFinding']).toBeNull();
    expect(body['approval']).toMatchObject({ status: 'PENDING' });
    expect(body['report'].exclusions.map((e: Body) => e['reason'])).toEqual(['NON_RECURRING']);
    expect(body['report'].bridge).toMatchObject({
      churned: { amount: '0.00' },
      closing: { amount: '33570.00' },
    });

    const cohorts = await call(
      'GET',
      `/v1/deals/${deals.HealthyCo}/metrics/cohorts`,
      leads.HealthyCo,
    );
    expect(cohorts.status).toBe(200);
    expect(cohorts.body['rows'][0]).toMatchObject({
      cohort: '2025-07',
      openingBalance: true,
      customers: 6,
    });
    expect(cohorts.body['rows'][1]).toMatchObject({ cohort: '2025-11', customers: 1 });
  });

  it('TroubledCo: inflated ARR surfaces as a cited draft finding', async () => {
    const { body } = await summary('TroubledCo');
    const reconciliation = body['reconciliation'];
    expect(reconciliation.status).toBe('DIFFERENCE');
    expect(reconciliation.reported.value).toEqual({ amount: '1450000.00', currency: 'USD' });
    // 12 650.00 USD + 1 500.00 GBP × (1.1700 / 0.8660) per month, × 12.
    expect(reconciliation.calculated).toEqual({ amount: '176118.71', currency: 'USD' });
    expect(reconciliation.explanation.slice(0, 3)).toEqual([
      expect.objectContaining({
        reason: 'INVOICE_VOID',
        amount: { amount: '720000.00', currency: 'USD' },
      }),
      expect.objectContaining({
        reason: 'INVOICE_UNCOLLECTIBLE',
        amount: { amount: '300000.00', currency: 'USD' },
      }),
      expect.objectContaining({
        reason: 'NON_RECURRING',
        amount: { amount: '150000.00', currency: 'USD' },
      }),
    ]);
    const kestrel = (body['report'].customers as Body[]).find(
      (c) => c['customerId'] === 'tc-cus-0005',
    )!;
    expect(kestrel['contributions'][0]).toMatchObject({
      original: { amount: '1500.00', currency: 'GBP' },
      fx: { rate: '1.3510392610', rateDate: '2026-09-30', source: 'ECB' },
    });
    expect(metric(body, 'NRR').value).toBe('0.6605');

    const finding = body['draftFinding'];
    expect(finding).toMatchObject({
      status: 'DRAFT',
      kind: 'ARR_RECONCILIATION_DIFFERENCE',
      severity: 'CRITICAL',
      requiresHumanReview: true,
      reconciliationId: reconciliation.reconciliationId,
    });
    expect(finding.evidence[0].sourceRecordId).toBe('tc-kpi-arr-2026q3');
    for (const cited of finding.evidence as Body[]) {
      const lineage = await call(
        'GET',
        `/v1/deals/${deals.TroubledCo}/evidence/${cited['evidenceId']}/lineage`,
        leads.TroubledCo,
      );
      expect(lineage.status).toBe(200);
      expect(lineage.body['citations'].map((c: Body) => c['id'])).toContain(cited['citationId']);
    }
  });

  it('records a reconciliation idempotently and proposes the draft finding once', async () => {
    const url = `/v1/deals/${deals.TroubledCo}/metrics/reconcile`;
    const first = await call('POST', url, analyst, {});
    expect(first.status).toBe(200);
    expect(first.body['draftFindingRecorded']).toBe(true);
    const counts = await outboxCount(deals.TroubledCo);
    expect(counts).toEqual({ 'finding.draft_proposed': 1, 'metrics.reconciliation.recorded': 1 });
    await call('POST', url, analyst, {});
    expect(await outboxCount(deals.TroubledCo)).toEqual(counts);
  });

  it('lets only a reviewer approve the current difference, once', async () => {
    const { body } = await summary('TroubledCo');
    const id = body['reconciliation'].reconciliationId as string;
    const url = (rid: string) => `/v1/deals/${deals.TroubledCo}/metrics/reconcile/${rid}/approve`;
    const payload = {
      asOf: '2026-09',
      note: 'Void and uncollectible invoices excluded; difference accepted for pricing.',
    };

    expect((await call('POST', url(id), analyst, payload)).status).toBe(403);
    expect((await call('POST', url(id), reviewer, { asOf: '2026-09', note: '' })).status).toBe(400);
    expect((await call('POST', url('0'.repeat(64)), reviewer, payload)).status).toBe(409);

    const approved = await call('POST', url(id), reviewer, payload);
    expect(approved.status).toBe(200);
    expect(approved.body['approval']).toMatchObject({
      status: 'APPROVED',
      reconciliationId: id,
      note: payload.note,
    });
    const again = await call('POST', url(id), reviewer, payload);
    expect(again.body['approval'].status).toBe('APPROVED');
    expect((await outboxCount(deals.TroubledCo))['metrics.reconciliation.approved']).toBe(1);
    const twin = await call('GET', `/v1/deals/${twinDealId}/metrics/summary`, leads.TroubledCo);
    expect(twin.body['approval']).toMatchObject({ status: 'PENDING', reconciliationId: null });

    const audit = (await db.owner.query(
      `SELECT action, outcome FROM audit_events WHERE deal_id = $1 AND action LIKE 'metrics.reconciliation.%' ORDER BY chain_seq`,
      [deals.TroubledCo],
    )) as { rows: { action: string; outcome: string }[] };
    expect(audit.rows).toContainEqual({
      action: 'metrics.reconciliation.approved',
      outcome: 'DENIED',
    });
    expect(
      audit.rows.filter(
        (r) => r.action === 'metrics.reconciliation.approved' && r.outcome === 'SUCCEEDED',
      ),
    ).toHaveLength(1);
  });

  it('marks the approval stale when the underlying evidence changes', async () => {
    await db.owner.query(
      `INSERT INTO evidence_items (id, organization_id, deal_id, connection_id, first_sync_run_id, last_sync_run_id,
                                   evidence_type, source_system, source_record_id, observed_at, canonical, content_hash)
       SELECT $1, organization_id, deal_id, connection_id, first_sync_run_id, last_sync_run_id, evidence_type,
              source_system, source_record_id, observed_at, jsonb_set(canonical, '{value}', '"1400000.00"'), repeat('a', 64)
         FROM evidence_items WHERE deal_id = $2 AND source_record_id = 'tc-kpi-arr-2026q3'`,
      [newId(), deals.TroubledCo],
    );
    const { body } = await summary('TroubledCo');
    expect(body['reconciliation'].reported.value.amount).toBe('1400000.00');
    expect(body['approval']).toMatchObject({ status: 'STALE' });
    expect(body['approval'].reconciliationId).not.toBe(body['reconciliation'].reconciliationId);
  });

  it('SparseCo: surfaces gaps instead of filling them', async () => {
    const { body } = await summary('SparseCo');
    expect(metric(body, 'NRR')).toMatchObject({
      value: null,
      unavailableReason: expect.stringContaining('2025-09'),
    });
    expect(body['reconciliation'].status).toBe('REPORTED_VALUE_MISSING');
    expect(body['draftFinding']).toBeNull();
    expect(body['approval'].status).toBe('NOT_REQUIRED');
    const reasons = new Set((body['report'].exclusions as Body[]).map((e) => e['reason']));
    for (const reason of [
      'MISSING_AMOUNT',
      'MISSING_CURRENCY',
      'INVALID_PERIOD',
      'DUPLICATE_LINE',
      'NO_FX_RATE',
      'STALE_FX_RATE',
    ])
      expect(reasons).toContain(reason);
    const northwind = (body['report'].customers as Body[]).filter(
      (c) => c['customerName'] === 'Northwind Supply (synthetic)',
    );
    expect(northwind.map((c) => c['customerId'])).toEqual(['sc-cus-0008']);
    const id = body['reconciliation'].reconciliationId as string;
    const res = await call(
      'POST',
      `/v1/deals/${deals.SparseCo}/metrics/reconcile/${id}/approve`,
      leads.SparseCo,
      { asOf: '2026-09', note: 'nothing to approve' },
    );
    expect(res.status).toBe(422);
  });

  it('keeps metrics from target contributors and other tenants', async () => {
    expect((await summary('HealthyCo', contributor)).status).toBe(403);
    expect((await summary('HealthyCo', outsider)).status).toBe(404);
    expect(
      (await call('POST', `/v1/deals/${deals.HealthyCo}/metrics/reconcile`, outsider, {})).status,
    ).toBe(404);
    expect((await summary('HealthyCo', leads.HealthyCo, '?asOf=2026-13')).status).toBe(400);
  });
});
