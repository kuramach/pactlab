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
    // Built-in keys, and the team's own (`custom.<slug>`); a metric named "unforecastable" is declined.
    const keys = [...prompt.matchAll(/^([a-z_]+|custom\.[a-z0-9-]+): /gm)].map((match) => match[1] ?? '').filter((key) => !key.includes('unforecastable'));
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

  it('the team defines its own metric, the AI forecasts it, and their line moves value by the chosen effect', async () => {
    type Metric = { key: string; label: string; ai: { values: string[] } | null; user: Body | null; custom?: { effect: string; definition: string } };
    const metrics = (body: Body) => (body['forecasts'] as { metrics: Metric[] }).metrics;
    const defined = await call(app, 'analyst', 'POST', '/metrics', { label: 'Texas RevPAR growth', definition: 'Revenue per available room for hotels in Texas, year on year.', neutral: '3', effect: 'GROWTH' });
    expect(defined.status).toBe(201);
    const mine = metrics(defined.body).find((metric) => metric.key === 'custom.texas-revpar-growth');
    expect(mine).toMatchObject({ label: 'Texas RevPAR growth', ai: null, custom: { effect: 'GROWTH' } });

    // The definition reaches the model as data; its answer is stored as the AI line.
    const forecast = await call(app, 'analyst', 'POST', '/metrics/custom.texas-revpar-growth/ai-forecast');
    expect(forecast.status).toBe(201);
    expect(metrics(forecast.body).find((metric) => metric.key === 'custom.texas-revpar-growth')?.ai?.values).toEqual(['3', '3', '3', '3', '3']);

    // The team's own line counts in their outcome, as a growth metric.
    const saved = await call(app, 'analyst', 'POST', '/user-forecasts', { metricKey: 'custom.texas-revpar-growth', values: ['8', '8', '8', '8', '8'] });
    expect(saved.status).toBe(201);
    expect((saved.body['forecasts'] as { outcomes: { user: { basis: Body[] } } }).outcomes.user.basis).toContainEqual({ key: 'custom.texas-revpar-growth', used: 'USER' });

    // A metric the model cannot forecast says so; nothing is stored.
    await call(app, 'analyst', 'POST', '/metrics', { label: 'Unforecastable thing', definition: 'Something nobody can see coming.', neutral: '0', effect: 'TRACK' });
    expect((await call(app, 'analyst', 'POST', '/metrics/custom.unforecastable-thing/ai-forecast')).status).toBe(422);
    // A second metric with the same name gets its own key; archiving hides it.
    const twin = await call(app, 'analyst', 'POST', '/metrics', { label: 'Texas RevPAR growth', definition: 'A second view.', neutral: '3', effect: 'RISK' });
    expect(metrics(twin.body).map((metric) => metric.key)).toContain('custom.texas-revpar-growth-2');
    const archived = await call(app, 'analyst', 'POST', '/metrics/custom.texas-revpar-growth-2/archive');
    expect(metrics(archived.body).map((metric) => metric.key)).not.toContain('custom.texas-revpar-growth-2');

    expect((await call(app, 'viewer', 'POST', '/metrics', { label: 'Nope', definition: 'Viewers cannot.', neutral: '1', effect: 'TRACK' })).status).toBe(403);
    expect((await call(offline, 'other_lead', 'POST', '/metrics', { label: 'Offline metric', definition: 'With AI off.', neutral: '1', effect: 'TRACK' }, b.dealId)).status).toBe(201);
    expect((await call(offline, 'other_lead', 'POST', '/metrics/custom.offline-metric/ai-forecast', undefined, b.dealId)).status).toBe(503);
    const audit = await db.owner.query<{ action: string }>(`SELECT DISTINCT action FROM audit_events WHERE deal_id = $1`, [a.dealId]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['foresight.metric_defined', 'foresight.metric_ai_forecast', 'foresight.metric_archived']));
  });

  it('retries missing AI forecasts within the hour once AI is on, not after 30 days (batch 2)', async () => {
    await call(app, 'lead', 'GET', '');
    await app.get(ForesightService).whenIdle();
    // As if the last refresh ran with AI off two hours ago.
    await db.owner.query(`UPDATE foresight_baselines SET status = 'PARTIAL', notes = ARRAY['AI is off in this environment: AI forecasts appear once it is switched on.'], started_at = now() - interval '2 hours', finished_at = now() - interval '2 hours' WHERE deal_id = $1`, [a.dealId]);
    await db.owner.query(`DELETE FROM foresight_forecasts WHERE deal_id = $1 AND source = 'AI'`, [a.dealId]);
    await call(app, 'lead', 'GET', '');
    await app.get(ForesightService).whenIdle();
    const forecasts = (await call(app, 'lead', 'GET', '')).body['forecasts'] as { status: string; metrics: { key: string; ai: Body | null }[] };
    expect(forecasts.status).toBe('READY');
    expect(forecasts.metrics.every((metric) => metric.ai !== null || metric.key.startsWith('custom.'))).toBe(true);
    // A fresh partial result is not retried again at once.
    await db.owner.query(`UPDATE foresight_baselines SET status = 'PARTIAL', notes = ARRAY['The AI forecast could not be made just now; it will be tried again later.'], finished_at = now() WHERE deal_id = $1`, [a.dealId]);
    await call(app, 'lead', 'GET', '');
    expect(((await call(app, 'lead', 'GET', '')).body['forecasts'] as { status: string }).status).toBe('PARTIAL');
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
