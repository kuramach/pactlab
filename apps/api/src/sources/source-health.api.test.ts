import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MacroForecastProvider, MacroForecastResult } from '@pactlab/connectors';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { SourceHealthService } from './source-health.service';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const SECRET = 'source-health-test-secret-'.padEnd(48, 'x');
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** The IMF as live sees it: answering, or blocked the way it blocks GitHub's runners (T-137). */
class SwitchableImf implements MacroForecastProvider {
  readonly name = 'imf-test';
  blocked = false;
  calls = 0;
  async forecast(indicator: string, area: string, years: readonly number[]): Promise<MacroForecastResult> {
    this.calls += 1;
    if (this.blocked) return { status: 'UNAVAILABLE', reason: 'PROVIDER_ERROR', detail: '403 text/html' };
    return { status: 'OK', series: { indicator, area, values: Object.fromEntries(years.map((y) => [y, '2.0'])), sourceName: 'IMF World Economic Outlook (test)', sourceUrl: 'https://example.invalid', asOf: null } };
  }
}

/** Live checks the public data it uses, from its own network (T-137 follow-up). */
describe('public data source checks', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let operator: SyntheticTenant;
  let customer: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const imf = new SwitchableImf();
  const mail = new CapturingEmailSender();
  const sign = (tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST', url: string) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: response.statusCode, body: response.json() as Body };
  }
  const row = async () => (await call('operator', 'GET', '/v1/admin/source-status')).body['items'] as Body[];
  const alerts = () => mail.sent.filter((m) => m.subject.includes('IMF'));

  beforeAll(async () => {
    db = await startTestDatabase();
    operator = await createSyntheticTenant(db.owner, 'Pactlab Ops');
    customer = await createSyntheticTenant(db.owner, 'Customer');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator.userId]);
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      environment: 'production',
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      macroForecasts: imf,
      sourceChecks: { intervalHours: 6, operatorEmail: 'ops@pactlab.test' },
    });
    tokens['operator'] = await sign(operator);
    tokens['customer'] = await sign(customer);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  beforeEach(() => {
    imf.blocked = false;
  });

  it('is for operators only', async () => {
    expect((await call('customer', 'GET', '/v1/admin/source-status')).status).toBe(403);
    expect((await call('customer', 'POST', '/v1/admin/source-status/check')).status).toBe(403);
    expect(imf.calls).toBe(0);
  });

  it('records a reachable source, with no email for a first OK', async () => {
    expect(await row()).toEqual([]);
    const checked = await call('operator', 'POST', '/v1/admin/source-status/check');
    expect(checked.status).toBe(200);
    expect(checked.body['items']).toEqual([expect.objectContaining({ source: 'imf-weo', label: 'IMF World Economic Outlook', status: 'OK', failingSince: null, detail: null, checkedAt: expect.any(String), lastOkAt: expect.any(String) })]);
    expect(alerts()).toEqual([]);
  });

  it('alerts once when live cannot reach the IMF, says what came back, and alerts once on recovery', async () => {
    imf.blocked = true;
    await call('operator', 'POST', '/v1/admin/source-status/check');
    expect(await row()).toEqual([expect.objectContaining({ status: 'FAILING', detail: 'PROVIDER_ERROR · 403 text/html', failingSince: expect.any(String) })]);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({ to: 'ops@pactlab.test', subject: 'Pactlab production: IMF World Economic Outlook unreachable' });
    expect(alerts()[0]?.text).toContain('(PROVIDER_ERROR · 403 text/html)');
    const since = (await row())[0]?.['failingSince'];
    // Still failing: no second email, and the failure keeps its start.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await call('operator', 'POST', '/v1/admin/source-status/check');
    expect(alerts()).toHaveLength(1);
    expect((await row())[0]?.['failingSince']).toBe(since);
    imf.blocked = false;
    await call('operator', 'POST', '/v1/admin/source-status/check');
    expect(await row()).toEqual([expect.objectContaining({ status: 'OK', failingSince: null, detail: null })]);
    expect(alerts()).toHaveLength(2);
    expect(alerts()[1]?.subject).toBe('Pactlab production: IMF World Economic Outlook is back');
  });

  it('a scheduled check within the interval is skipped, so restarts and several API tasks never re-check early', async () => {
    const service = app.get(SourceHealthService);
    const before = imf.calls;
    expect(await service.run(false)).toBe('SKIPPED');
    expect(imf.calls).toBe(before);
    // Once the interval has passed, it checks.
    await db.owner.query(`UPDATE external_source_status SET claimed_at = now() - interval '7 hours'`);
    expect(await service.run(false)).toBe('CHECKED');
    expect(imf.calls).toBe(before + 1);
  });
});
