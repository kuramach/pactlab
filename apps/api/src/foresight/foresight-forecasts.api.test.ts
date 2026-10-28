import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway, type ModelRequest } from '@pactlab/ai';
import type { MacroForecastProvider } from '@pactlab/connectors';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { ForesightService } from './foresight.service';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

/** Scripted (synthetic) model: a forecast for every metric asked, plus one never asked for; trend answers for the trend prompt. */
function modelReply(request: ModelRequest): unknown {
  const prompt = request.messages[0]?.content ?? '';
  if (request.system.includes('five-year forecast for each economic or sector metric')) {
    const keys = [...prompt.matchAll(/^([a-z_]+): /gm)].map((match) => match[1] ?? '');
    return {
      metrics: [
        ...keys.map((key) => ({ key, values: key === 'inflation' ? [2.5, 2.4, 2.2, 2.1, 2] : [3, 3, 3, 3, 3], rationale: `Synthetic rationale for ${key}: balanced drivers.` })),
        { key: 'invented_metric', values: [9, 9, 9, 9, 9], rationale: 'Never asked for; must be ignored.' },
      ],
    };
  }
  const keys = [...prompt.matchAll(/^([a-z_]+\.[a-z_]+):/gm)].map((match) => match[1] ?? '');
  return { trends: keys.map((key) => ({ key, direction: 'FLAT', magnitude: 'LOW', confidence: 'MEDIUM', narrative: `Synthetic narrative for ${key}: balanced drivers both ways.` })) };
}

const unavailable: MacroForecastProvider = { name: 'down', forecast: () => Promise.resolve({ status: 'UNAVAILABLE', reason: 'PROVIDER_ERROR' }) };

describe('Foresight forecasts (T-094 B10)', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let offline: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(signingKey);

  async function call(target: NestFastifyApplication, who: string, method: 'GET' | 'POST', path: string, payload?: unknown, dealId?: string) {
    const response = await target.inject({ method, url: `/v1/deals/${dealId ?? a.dealId}/foresight${path}`, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    for (const tenant of [a, b]) {
      await db.owner.query(`INSERT INTO deal_parties (id, organization_id, deal_id, role, name, ownership, company_type, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SELLER', 'Seller (synthetic)', 'PRIVATE', 'HOTELS', now())`, [tenant.organizationId, tenant.dealId]);
      await db.owner.query(
        `INSERT INTO asking_prices (id, organization_id, deal_id, version, amount, currency, basis, source, recorded_by, recorded_at) VALUES (gen_random_uuid(), $1, $2, 1, 30000000, 'USD', 'ENTERPRISE_VALUE', 'TEASER', $3, now())`,
        [tenant.organizationId, tenant.dealId, tenant.userId],
      );
    }
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const verifier = new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) });
    const gateway = new TransportClaudeGateway({ transport: new ScriptedModelTransport((request) => JSON.stringify(modelReply(request))), registry: defaultPromptRegistry() });
    app = await createApp({ prisma: db.prisma, identityVerifier: verifier, logger: createLogger('api-test', { level: 'silent' }), documents: { gateway }, aiStatus: { enabled: true, provider: 'synthetic', region: null, routes: [] } });
    // A second app with the provider down and AI off: failures must be stated, never silent.
    offline = await createApp({ prisma: db.prisma, identityVerifier: verifier, logger: createLogger('api-test', { level: 'silent' }), macroForecasts: unavailable });
    tokens['lead'] = await token(a.subject, a);
    tokens['other'] = await token(b.subject, b);
    tokens['other_lead'] = tokens['other'];
    for (const role of ['ANALYST', 'VIEWER', 'TARGET_CONTRIBUTOR'] as const) tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, a, role)).subject, a);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await offline?.close();
    await db?.stop();
  });

  it('opening Foresight starts the baseline in the background; it fills with published and AI forecasts and the trend lines', async () => {
    const first = await call(app, 'viewer', 'GET', '');
    expect(first.status).toBe(200);
    expect((first.body['forecasts'] as Body)['status']).toMatch(/^(RUNNING|READY)$/);
    await app.get(ForesightService).whenIdle();

    const view = (await call(app, 'viewer', 'GET', '')).body;
    const forecasts = view['forecasts'] as { status: string; notes: string[]; years: number[]; area: string; metrics: Body[]; outcomes: Body };
    expect(forecasts.status).toBe('READY');
    expect(forecasts.notes).toEqual([]);
    expect(forecasts.area).toBe('USA');
    expect(forecasts.years).toHaveLength(5);
    expect(forecasts.metrics.map((metric) => metric['key'])).toEqual(['inflation', 'gdp_growth', 'revpar_growth']);
    const inflation = forecasts.metrics[0] as { external: Body; ai: Body; user: Body | null };
    expect(inflation.external).toMatchObject({ values: ['3', '2.7', '2.4', '2.1', '2'], sourceName: 'Synthetic macro forecast (fixture)', version: 1 });
    expect(inflation.ai).toMatchObject({ values: ['2.5', '2.4', '2.2', '2.1', '2'], rationale: expect.stringContaining('Synthetic rationale') });
    expect(inflation.user).toBeNull();
    // The sector metric has no published forecast; the AI's stands alone.
    expect(forecasts.metrics[2]).toMatchObject({ external: null, ai: { values: ['3', '3', '3', '3', '3'] } });
    expect(forecasts.metrics.map((metric) => metric['key'])).not.toContain('invented_metric');
    // With no user forecasts both outcome sets are the same, and say which series they used.
    const outcomes = forecasts.outcomes as { reference: { path: Body[]; basis: Body[] }; user: { path: Body[] }; startValue: string };
    expect(outcomes.startValue).toBe('30000000');
    expect(outcomes.reference.path).toHaveLength(6);
    expect(outcomes.user.path).toEqual(outcomes.reference.path);
    expect(outcomes.reference.basis).toEqual([
      { key: 'inflation', used: 'AI' },
      { key: 'gdp_growth', used: 'AI' },
      { key: 'revpar_growth', used: 'AI' },
    ]);
    // The trend lines are there too, without anyone pressing a button.
    expect(view['baseline']).toMatchObject({ promptVersion: 'foresight.trends@1' });
    const runs = await db.owner.query(`SELECT task_type FROM ai_runs WHERE deal_id = $1 ORDER BY created_at`, [a.dealId]);
    expect((runs.rows as Body[]).map((row) => row['task_type'])).toEqual(['foresight.forecast', 'foresight.trends']);

    // Opening it again does not refresh a fresh baseline.
    await call(app, 'lead', 'GET', '');
    await app.get(ForesightService).whenIdle();
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM ai_runs WHERE deal_id = $1`, [a.dealId])).rows[0]).toEqual({ n: 2 });
  });

  it('a user forecast is versioned, audited and changes only the user outcome', async () => {
    const before = ((await call(app, 'lead', 'GET', '')).body['forecasts'] as { outcomes: { reference: { path: Body[] } } }).outcomes.reference.path;
    const saved = await call(app, 'analyst', 'POST', '/user-forecasts', { metricKey: 'revpar_growth', values: ['6', '5', '4', '4', '4'] });
    expect(saved.status).toBe(201);
    const forecasts = saved.body['forecasts'] as { metrics: { key: string; user: Body | null }[]; outcomes: { reference: { path: Body[] }; user: { path: { value: string }[]; basis: Body[] } } };
    expect(forecasts.metrics.find((metric) => metric.key === 'revpar_growth')?.user).toMatchObject({ values: ['6', '5', '4', '4', '4'], version: 1, createdByName: expect.any(String) });
    expect(forecasts.outcomes.reference.path).toEqual(before);
    expect(forecasts.outcomes.user.basis).toContainEqual({ key: 'revpar_growth', used: 'USER' });
    expect(Number(forecasts.outcomes.user.path[5]?.value)).toBeGreaterThan(Number((before[5] as { value: string }).value));

    const again = await call(app, 'analyst', 'POST', '/user-forecasts', { metricKey: 'revpar_growth', values: ['5', '5', '5', '5', '5'] });
    expect((again.body['forecasts'] as { metrics: { key: string; user: Body | null }[] }).metrics.find((metric) => metric.key === 'revpar_growth')?.user).toMatchObject({ version: 2 });
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'foresight.user_forecast_saved'`, [a.dealId])).rows[0]).toEqual({ n: 2 });

    expect((await call(app, 'analyst', 'POST', '/user-forecasts', { metricKey: 'not_a_metric', values: ['1', '1', '1', '1', '1'] })).status).toBe(422);
    expect((await call(app, 'analyst', 'POST', '/user-forecasts', { metricKey: 'inflation', values: ['1', '1'] })).status).toBe(400);
    expect((await call(app, 'viewer', 'POST', '/user-forecasts', { metricKey: 'inflation', values: ['1', '1', '1', '1', '1'] })).status).toBe(403);
    expect((await call(app, 'target_contributor', 'GET', '')).status).toBe(403);
    expect((await call(app, 'other', 'GET', '', undefined, a.dealId)).status).toBe(404);
  });

  it('with the provider down and AI off, the baseline says what is missing instead of failing silently', async () => {
    const started = await call(offline, 'other_lead', 'POST', '/baseline', undefined, b.dealId);
    expect(started.status).toBe(202);
    await offline.get(ForesightService).whenIdle();
    const forecasts = (await call(offline, 'other_lead', 'GET', '', undefined, b.dealId)).body['forecasts'] as { status: string; notes: string[]; outcomes: { reference: { basis: Body[] } } };
    expect(forecasts.status).toBe('FAILED');
    expect(forecasts.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('published inflation (consumer prices) forecast could not be fetched'), expect.stringContaining('AI is off in this environment')]),
    );
    // The outcome still renders, on neutral levels, and says so.
    expect(forecasts.outcomes.reference.basis.every((entry) => entry['used'] === 'NEUTRAL')).toBe(true);
  });
});
