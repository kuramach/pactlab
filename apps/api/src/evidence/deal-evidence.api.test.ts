import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { checkAdapterContract } from '@pactlab/connectors';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { newId, type EvidenceLineage } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { CsvFixtureAdapter } from '../connections/adapters/csv-fixture.adapter';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Body = Record<string, unknown>;

/**
 * Deal/evidence spine through the real HTTP stack: auth guard, deal
 * authorization, RLS, fixture CSV connection, idempotent sync and lineage.
 */
describe('deal/evidence spine API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  let lead: string;
  let other: string;
  let connectionId: string;

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

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    bearer: string,
    payload?: Body,
    headers: Record<string, string> = {},
  ) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${bearer}`, ...headers },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Body };
  }

  const base = () => `/v1/deals/${a.dealId}`;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const identityVerifier = new JwtIdentityVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: createLocalJWKSet({ keys: [jwk] }),
    });
    app = await createApp({
      prisma: db.prisma,
      identityVerifier,
      logger: createLogger('api-test', { level: 'silent' }),
    });
    lead = await token(a.subject, a.auth0OrganizationId);
    other = await token(b.subject, b.auth0OrganizationId);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('the CSV fixture adapter satisfies the connector contract', async () => {
    const adapter = new CsvFixtureAdapter([
      'HealthyCo/customers.csv',
      'HealthyCo/management-kpis.csv',
    ]);
    const scope = {
      organizationId: newId(),
      dealId: newId(),
      connectionId: newId(),
      credentialRef: null,
    };
    await expect(checkAdapterContract(adapter, scope)).resolves.toEqual([]);
    const unknown = await new CsvFixtureAdapter(['../../etc/passwd']).validateConnection(scope);
    expect(unknown.ok).toBe(false);
  });

  it('creates a FIXTURE connection, validates it and dry-runs without persisting evidence', async () => {
    const created = await call('POST', `${base()}/connections`, lead, {
      provider: 'csv',
      displayName: 'HealthyCo export',
      mode: 'FIXTURE',
      config: { datasets: ['HealthyCo/customers.csv', 'HealthyCo/management-kpis.csv'] },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      mode: 'FIXTURE',
      hasCredential: false,
      evidenceVisibility: 'BUYER_ONLY',
    });
    connectionId = created.body['id'] as string;

    const validation = await call('POST', `${base()}/connections/${connectionId}/validate`, lead);
    expect(validation.status).toBe(200);
    expect(validation.body).toMatchObject({
      ok: true,
      provider: 'csv',
      adapterVersion: 'csv-fixture-1',
    });

    const dry = await call('POST', `${base()}/connections/${connectionId}/dry-run`, lead, {
      limit: 3,
    });
    expect(dry.status).toBe(200);
    expect((dry.body['sample'] as unknown[]).length).toBe(3);
    expect(dry.body['truncated']).toBe(true);
    expect(JSON.stringify(dry.body)).not.toContain('"quote"');
    expect((await call('GET', `${base()}/evidence`, lead)).body['items']).toEqual([]);
  });

  it('rejects secrets in place of a credential reference and a LIVE switch without one', async () => {
    const leaked = await call('POST', `${base()}/connections`, lead, {
      provider: 'csv',
      displayName: 'x',
      mode: 'LIVE',
      credentialRef: 'sk_live_raw-secret',
      config: { datasets: ['HealthyCo/customers.csv'] },
    });
    expect(leaked.status).toBe(400);
    expect(
      (await call('PUT', `${base()}/connections/${connectionId}/mode`, lead, { mode: 'LIVE' }))
        .status,
    ).toBe(409);
  });

  it('runs an idempotent sync: replaying the key returns the same run and creates no duplicates', async () => {
    const idem = { 'idempotency-key': `sync-${newId()}` };
    expect((await call('POST', `${base()}/sync-runs`, lead, { connectionId })).status).toBe(400);
    const first = await call('POST', `${base()}/sync-runs`, lead, { connectionId }, idem);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: 'SUCCEEDED', recordsCreated: 9, recordsSeen: 9 });
    const replay = await call('POST', `${base()}/sync-runs`, lead, { connectionId }, idem);
    expect(replay.body).toMatchObject({ id: first.body['id'], status: 'SUCCEEDED' });

    const resync = await call(
      'POST',
      `${base()}/sync-runs`,
      lead,
      { connectionId },
      { 'idempotency-key': `sync-${newId()}` },
    );
    expect(resync.body).toMatchObject({ recordsCreated: 0, recordsUnchanged: 9 });

    const list = await call('GET', `${base()}/evidence?limit=100`, lead);
    expect((list.body['items'] as unknown[]).length).toBe(9);
    expect(list.body['types']).toEqual(['billing.customer', 'management.kpi']);
    const run = await call('GET', `${base()}/sync-runs/${first.body['id'] as string}`, lead);
    expect(run.body).toMatchObject({ status: 'SUCCEEDED', connectorVersion: 'csv-fixture-1' });
  });

  it('filters evidence and resolves each item’s lineage back to the source system', async () => {
    const filtered = await call('GET', `${base()}/evidence?type=management.kpi`, lead);
    const items = filtered.body['items'] as { id: string; sourceRecordId: string }[];
    expect(items.map((item) => item.sourceRecordId).sort()).toEqual([
      'hc-kpi-arr-2026q3',
      'hc-kpi-logos-2026q3',
      'hc-kpi-nrr-2026q3',
    ]);

    const lineage = await call('GET', `${base()}/evidence/${items[0]!.id}/lineage`, lead);
    expect(lineage.status).toBe(200);
    const body = lineage.body as unknown as EvidenceLineage;
    expect(body.evidence).toMatchObject({ sourceSystem: 'csv', evidenceType: 'management.kpi' });
    expect(body.connection).toMatchObject({ id: connectionId, mode: 'FIXTURE', provider: 'csv' });
    expect(body.syncRun.status).toBe('SUCCEEDED');
    expect(body.citations[0]?.locator).toMatchObject({
      kind: 'csv_row',
      dataset: 'HealthyCo/management-kpis.csv',
    });

    expect((await call('GET', `${base()}/evidence?unknown=1`, lead)).status).toBe(400);
  });

  it("returns 404 for another tenant's deal, evidence, connections and runs", async () => {
    const item = (
      (await call('GET', `${base()}/evidence`, lead)).body['items'] as { id: string }[]
    )[0]!;
    for (const url of [
      `${base()}/evidence`,
      `${base()}/evidence/${item.id}/lineage`,
      `${base()}/connections`,
    ]) {
      expect((await call('GET', url, other)).status).toBe(404);
    }
    expect(
      (
        await call(
          'POST',
          `${base()}/sync-runs`,
          other,
          { connectionId },
          { 'idempotency-key': `x-${newId()}` },
        )
      ).status,
    ).toBe(404);
    // Even through the attacker's own deal path, the foreign item is invisible.
    expect(
      (await call('GET', `/v1/deals/${b.dealId}/evidence/${item.id}/lineage`, other)).status,
    ).toBe(404);
  });

  it('keeps buyer-only evidence from target contributors until a deal lead shares it', async () => {
    const contributor = await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR');
    const bearer = await token(contributor.subject, a.auth0OrganizationId);
    const empty = await call('GET', `${base()}/evidence`, bearer);
    expect(empty.status).toBe(200);
    expect(empty.body['items']).toEqual([]);

    const item = (
      (await call('GET', `${base()}/evidence`, lead)).body['items'] as { id: string }[]
    )[0]!;
    expect((await call('GET', `${base()}/evidence/${item.id}/lineage`, bearer)).status).toBe(404);
    expect((await call('POST', `${base()}/evidence/${item.id}/share`, bearer)).status).toBe(403);
    expect(
      (
        await call(
          'POST',
          `${base()}/sync-runs`,
          bearer,
          { connectionId },
          { 'idempotency-key': `c-${newId()}` },
        )
      ).status,
    ).toBe(403);

    expect((await call('POST', `${base()}/evidence/${item.id}/share`, lead)).body).toMatchObject({
      visibility: 'SHARED',
    });
    const visible = await call('GET', `${base()}/evidence`, bearer);
    expect((visible.body['items'] as { id: string }[]).map((row) => row.id)).toEqual([item.id]);
    expect((await call('GET', `${base()}/evidence/${item.id}/lineage`, bearer)).status).toBe(200);
  });

  it('denies evidence to roles without EVIDENCE_READ and audits the denial', async () => {
    const viewer = await addSyntheticDealMember(db.owner, a, 'VIEWER');
    const bearer = await token(viewer.subject, a.auth0OrganizationId);
    expect((await call('GET', `${base()}/evidence`, bearer)).status).toBe(403);
    const denied = (await db.owner.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id = $1 AND outcome = 'DENIED'`,
      [viewer.userId],
    )) as { rows: { n: number }[] };
    expect(denied.rows[0]?.n).toBe(1);
  });

  describe('deals', () => {
    it('creates a deal (creator becomes DEAL_LEAD), patches it and manages members', async () => {
      const created = await call('POST', '/v1/deals', lead, {
        name: 'Project Spine',
        targetName: 'SpineCo (synthetic)',
        transactionType: 'TAKE_PRIVATE',
      });
      expect(created.status).toBe(201);
      const dealId = created.body['id'] as string;
      expect(created.body).toMatchObject({
        organizationId: a.organizationId,
        baseCurrency: 'USD',
        transactionType: 'TAKE_PRIVATE',
      });

      const patched = await call('PATCH', `/v1/deals/${dealId}`, lead, { stage: 'DILIGENCE' });
      expect(patched.body).toMatchObject({ stage: 'DILIGENCE' });
      expect(
        (await call('PATCH', `/v1/deals/${dealId}`, lead, { transactionType: 'PUBLIC_ACQUIRER' }))
          .status,
      ).toBe(400);

      const analyst = await addSyntheticDealMember(db.owner, a, 'ANALYST');
      const added = await call('POST', `/v1/deals/${dealId}/members`, lead, {
        userId: analyst.userId,
        role: 'REVIEWER',
      });
      expect(added.status).toBe(201);
      const members = await call('GET', `/v1/deals/${dealId}/members`, lead);
      expect(
        (members.body['items'] as { role: string }[]).map((member) => member.role).sort(),
      ).toEqual(['DEAL_LEAD', 'REVIEWER']);

      // Users from another organization cannot be added; other tenants cannot see the deal.
      expect(
        (
          await call('POST', `/v1/deals/${dealId}/members`, lead, {
            userId: b.userId,
            role: 'VIEWER',
          })
        ).status,
      ).toBe(404);
      expect((await call('PATCH', `/v1/deals/${dealId}`, other, { stage: 'CLOSED' })).status).toBe(
        404,
      );
    });

    it('forbids deal writes and member management without the permission', async () => {
      const reviewer = await addSyntheticDealMember(db.owner, a, 'REVIEWER');
      const bearer = await token(reviewer.subject, a.auth0OrganizationId);
      expect((await call('PATCH', base(), bearer, { stage: 'CLOSED' })).status).toBe(403);
      expect(
        (
          await call('POST', `${base()}/members`, bearer, {
            userId: reviewer.userId,
            role: 'DEAL_LEAD',
          })
        ).status,
      ).toBe(403);
    });
  });
});
