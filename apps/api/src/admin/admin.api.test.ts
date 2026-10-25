import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { decide, listPending } from '../ops/organizations';
import { AdminService } from './admin.service';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

/** A 1×1 transparent PNG (synthetic). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('operator console and bug reports (T-072)', { timeout: 30_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let operatorTenant: SyntheticTenant;
  let customer: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};

  const token = (tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(tenant.subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(who: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body && response.headers['content-type']?.toString().includes('json') ? response.json() : response.body) as Body, raw: response };
  }
  const audit = async (action: string) => ((await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = $1`, [action])) as { rows: { n: number }[] }).rows[0]?.n;

  beforeAll(async () => {
    db = await startTestDatabase();
    operatorTenant = await createSyntheticTenant(db.owner, 'Pactlab Ops');
    customer = await createSyntheticTenant(db.owner, 'Customer');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operatorTenant.userId]);
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      environment: 'test',
      appVersion: '9.9.9',
    });
    tokens['operator'] = await token(operatorTenant);
    tokens['customer'] = await token(customer);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('refuses every console route to anyone who is not an operator', async () => {
    const routes: [string, string, unknown?][] = [
      ['GET', '/v1/admin'],
      ['GET', '/v1/admin/approvals'],
      ['POST', '/v1/admin/approvals/some-org', { decision: 'approve' }],
      ['GET', '/v1/admin/organizations'],
      ['PUT', `/v1/admin/organizations/${customer.organizationId}/status`, { status: 'SUSPENDED' }],
      ['PUT', `/v1/admin/organizations/${customer.organizationId}/flags`, { pilotMode: true, liveConnectors: false }],
      ['GET', '/v1/admin/users'],
      ['GET', '/v1/admin/connections'],
      ['GET', '/v1/admin/audit'],
      ['GET', '/v1/admin/bugs'],
      ['GET', `/v1/admin/bugs/${newId()}`],
    ];
    for (const [method, url, body] of routes) {
      expect((await call('customer', method as 'GET', url, body)).status, `${method} ${url}`).toBe(403);
    }
    expect((await call('operator', 'GET', '/v1/admin')).body).toEqual({ environment: 'test', appVersion: '9.9.9' });
  });

  it('approves a pending sign-up in the console exactly as the CLI does, and audits it', async () => {
    const orgId = newId();
    await db.owner.query(
      `INSERT INTO organizations (id, name, slug, auth_method, status, sso_requested, created_via, updated_at) VALUES ($1, 'Harbor (synthetic)', 'harbor-synthetic', 'EMAIL_CODE', 'PENDING_APPROVAL', true, 'SIGNUP', now())`,
      [orgId],
    );
    const pending = (await call('operator', 'GET', '/v1/admin/approvals')).body['items'] as Body[];
    expect(pending).toEqual([expect.objectContaining({ slug: 'harbor-synthetic', ssoRequested: true })]);
    // The CLI sees the same queue through the same function.
    expect((await listPending(db.owner)).map((org) => org.slug)).toEqual(['harbor-synthetic']);

    expect((await call('operator', 'POST', '/v1/admin/approvals/harbor-synthetic', { decision: 'approve' })).body).toMatchObject({ kind: 'changed', name: 'Harbor (synthetic)' });
    expect((await db.owner.query(`SELECT status FROM organizations WHERE id = $1`, [orgId])).rows).toEqual([{ status: 'ACTIVE' }]);
    expect(await decide(db.owner, 'harbor-synthetic', 'approve', { sender: null, loginUrl: 'x' })).toEqual({ kind: 'unchanged', status: 'ACTIVE' });
    const approvals = await db.owner.query(`SELECT actor_user_id FROM audit_events WHERE action = 'org.approved' AND organization_id = $1`, [orgId]);
    expect(approvals.rows).toEqual([{ actor_user_id: operatorTenant.userId }]);
  });

  it('lists organizations with usage, toggles flags without a deploy, suspends and reactivates', async () => {
    const orgs = (await call('operator', 'GET', '/v1/admin/organizations')).body['items'] as Body[];
    const row = orgs.find((org) => org['id'] === customer.organizationId);
    expect(row).toMatchObject({ members: 1, deals: { pre: 1, diligence: 0, post: 0 }, flags: { pilotMode: false, liveConnectors: true } });

    expect((await call('customer', 'GET', '/v1/organization/flags')).body).toEqual({ pilotMode: false, liveConnectors: true });
    expect((await call('operator', 'PUT', `/v1/admin/organizations/${customer.organizationId}/flags`, { pilotMode: true, liveConnectors: false })).status).toBe(200);
    expect((await call('customer', 'GET', '/v1/organization/flags')).body).toEqual({ pilotMode: true, liveConnectors: false });

    expect((await call('operator', 'PUT', `/v1/admin/organizations/${customer.organizationId}/status`, { status: 'SUSPENDED' })).body).toEqual({ changed: true });
    expect((await call('operator', 'PUT', `/v1/admin/organizations/${customer.organizationId}/status`, { status: 'ACTIVE' })).body).toEqual({ changed: true });
    expect(await audit('org.flags_changed')).toBe(1);
    expect(await audit('org.suspended')).toBe(1);
    expect(await audit('org.reactivated')).toBe(1);

    const events = (await call('operator', 'GET', '/v1/admin/audit?action=org.')).body['items'] as Body[];
    expect(events.map((event) => event['action'])).toEqual(expect.arrayContaining(['org.flags_changed', 'org.suspended', 'org.reactivated', 'org.approved']));
  });

  it('finds users across organizations and deactivates a membership (never their own)', async () => {
    const found = (await call('operator', 'GET', `/v1/admin/users?organizationId=${customer.organizationId}`)).body['items'] as Body[];
    expect(found).toEqual([expect.objectContaining({ userId: customer.userId, status: 'ACTIVE' })]);
    expect((await call('operator', 'PUT', `/v1/admin/organizations/${customer.organizationId}/members/${customer.userId}/status`, { status: 'SUSPENDED' })).body).toEqual({ changed: true });
    expect((await call('operator', 'PUT', `/v1/admin/organizations/${customer.organizationId}/members/${customer.userId}/status`, { status: 'ACTIVE' })).body).toEqual({ changed: true });
    expect((await call('operator', 'PUT', `/v1/admin/organizations/${operatorTenant.organizationId}/members/${operatorTenant.userId}/status`, { status: 'SUSPENDED' })).status).toBe(403);
    expect(await audit('member.deactivated')).toBe(1);
  });

  it('a user report with a screenshot reaches the inbox; triage shows in the reporter’s list; secrets never stored', async () => {
    const filed = await call('customer', 'POST', '/v1/bug-reports', {
      trigger: 'USER_REPORT',
      title: 'Import button does nothing',
      whatHappened: 'Clicked import; nothing happened. My token is Bearer abcdefghijklmnopqrstu',
      expected: 'The import to start',
      severity: 'HIGH',
      dealId: customer.dealId,
      context: { route: `/deals/${customer.dealId}/sources?token=s3cr3t-value`, userAgent: 'Synthetic browser', appVersion: '9.9.9' },
      screenshot: { contentType: 'image/png', data: PNG.toString('base64') },
    });
    expect(filed.status).toBe(201);
    expect(String(filed.body['reference'])).toMatch(/^PLB-\d{4}$/);
    const id = String(filed.body['id']);

    const stored = JSON.stringify((await db.owner.query(`SELECT title, what_happened, context FROM bug_reports WHERE id = $1`, [id])).rows);
    expect(stored).not.toContain('abcdefghijklmnopqrstu');
    expect(stored).not.toContain('s3cr3t-value');

    expect((await call('customer', 'GET', `/v1/admin/bugs/${id}`)).status).toBe(403);
    const inbox = (await call('operator', 'GET', '/v1/admin/bugs')).body['items'] as Body[];
    expect(inbox.find((bug) => bug['id'] === id)).toMatchObject({ trigger: 'USER_REPORT', severity: 'HIGH', status: 'NEW', hasScreenshot: true });
    const detail = (await call('operator', 'GET', `/v1/admin/bugs/${id}`)).body;
    expect(detail).toMatchObject({ dealId: customer.dealId, context: expect.objectContaining({ userAgent: 'Synthetic browser', environment: 'test' }) });
    const image = await call('operator', 'GET', `/v1/admin/bugs/${id}/screenshot`);
    expect(image.raw.headers['content-type']).toBe('image/png');
    expect(Buffer.from(image.raw.rawPayload).equals(PNG)).toBe(true);

    await call('operator', 'PUT', `/v1/admin/bugs/${id}`, { status: 'TRIAGED', severity: 'MEDIUM', internalNotes: 'Repro on fixtures' });
    const mine = (await call('customer', 'GET', '/v1/bug-reports/mine')).body['items'] as Body[];
    expect(mine).toEqual([expect.objectContaining({ id, status: 'TRIAGED', severity: 'MEDIUM' })]);
    expect(JSON.stringify(mine)).not.toContain('Repro on fixtures'); // internal notes stay with operators
    expect(await audit('bug.triaged')).toBe(1);

    const task = (await call('operator', 'GET', `/v1/admin/bugs/${id}/task?consoleUrl=http://localhost:3000`)).body;
    expect(task['fileName']).toMatch(/^PLB-\d{4}\.md$/);
    for (const part of ['Import button does nothing', 'MEDIUM', 'The import to start', 'Synthetic browser', 'http://localhost:3000/admin/bugs/']) {
      expect(String(task['markdown'])).toContain(part);
    }
  });

  it('automatic reports dedup by fingerprint; server errors are filed too', async () => {
    const crash = (dealId: string) => ({
      trigger: 'FRONTEND_EXCEPTION',
      title: 'Something went wrong',
      severity: 'MEDIUM',
      context: { route: `/deals/${dealId}/findings`, error: { name: 'TypeError', message: 'x is undefined', stack: `TypeError: x\n    at render (/app/deals/${dealId}/page.js:10:5)` } },
    });
    const first = await call('customer', 'POST', '/v1/bug-reports', crash(customer.dealId));
    const second = await call('customer', 'POST', '/v1/bug-reports', crash(newId()));
    expect(second.body).toMatchObject({ id: first.body['id'], deduplicated: true });
    const row = (await db.owner.query(`SELECT occurrences FROM bug_reports WHERE id = $1`, [first.body['id']])).rows;
    expect(row).toEqual([{ occurrences: 2 }]);

    await app.get(AdminService).fileServerError({ organizationId: customer.organizationId, userId: customer.userId, route: 'GET /v1/deals/:dealId/findings', errorName: 'PrismaClientKnownRequestError', stack: 'Error\n    at x (/api/findings.ts:1:1)', requestId: 'r1' });
    const inbox = (await call('operator', 'GET', '/v1/admin/bugs')).body['items'] as Body[];
    expect(inbox.some((bug) => bug['trigger'] === 'BACKEND_EXCEPTION' && String(bug['title']).includes('PrismaClientKnownRequestError'))).toBe(true);
  });
});
