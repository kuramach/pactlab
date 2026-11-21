import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiEnv } from '@pactlab/config';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { createAiGateway, FIXTURE_ROUTES, type AiModelsRuntime } from './ai-provider';
import { ModelRouteResolver } from './model-routes';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;
const GEMINI = 'gemini-3.1-pro-preview';

/** T-132: best-of-breed routing: each job's lanes, overrides, allow-lists, the cost ceiling, cost per job type. */
describe('job-type routing', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let operator: SyntheticTenant;
  let org: SyntheticTenant;
  let restricted: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const sign = (tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens['operator']}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const resolver = (routing: ConstructorParameters<typeof ModelRouteResolver>[3]) => new ModelRouteResolver(db.prisma, FIXTURE_ROUTES, Date.now, routing);
  const ids = (lanes: Awaited<ReturnType<ModelRouteResolver['lanesFor']>>) => (lanes === 'BLOCKED' ? lanes : lanes.map((lane) => `${lane.provider ?? 'bedrock'}:${lane.modelId}`));
  const ask = (target: SyntheticTenant, jobType: 'extraction' | 'document_qa' | 'deep_review') => ({ organizationId: target.organizationId, dealId: target.dealId, jobType, alias: 'balanced' as const });

  beforeAll(async () => {
    db = await startTestDatabase();
    operator = await createSyntheticTenant(db.owner, 'Pactlab Ops');
    org = await createSyntheticTenant(db.owner, 'Routed');
    restricted = await createSyntheticTenant(db.owner, 'Restricted');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator.userId]);
    const ai = await createAiGateway({ AI_PROVIDER: 'fixture' } as ApiEnv, db.prisma);
    // As if Google's key were set: the console may add Gemini, and the terms gate decides whether it serves.
    const models: AiModelsRuntime = { ...(ai.models as AiModelsRuntime), providers: ['fixture', 'google'] };
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({ prisma: db.prisma, identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }), logger: createLogger('api-test', { level: 'silent' }), aiModels: models, aiStatus: ai.status });
    tokens['operator'] = await sign(operator);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('a Claude-only deployment serves every job on its Claude lane, as before T-132', async () => {
    const lanes = resolver({ providers: ['fixture'] });
    for (const job of ['extraction', 'document_qa', 'deep_review'] as const) expect(ids(await lanes.lanesFor(ask(org, job))), job).toEqual(['fixture:synthetic-fixture']);
  });

  it('a lane at another provider serves only when connected, evaluated, with its terms recorded, and allowed', async () => {
    const connected = resolver({ providers: ['fixture', 'google'] });
    // Not in the catalog yet: the chain skips it.
    expect(ids(await connected.lanesFor(ask(org, 'extraction')))).toEqual(['fixture:synthetic-fixture']);
    const added = await call('POST', '/v1/admin/ai-models', { provider: 'google', providerModelId: GEMINI, label: 'Gemini 3.1 Pro' });
    const geminiId = added.body['id'] as string;
    await call('PUT', '/v1/admin/ai-models/providers/google/terms', { dpaInPlace: true, zeroRetention: true });
    expect((await call('POST', `/v1/admin/ai-models/${geminiId}/evaluation`)).status).toBe(202);
    for (let i = 0; i < 100 && !((await call('GET', '/v1/admin/ai-models')).body['models'] as { id: string; status: string }[]).some((m) => m.id === geminiId && m.status === 'EVALUATED'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    connected.invalidate();
    // Extraction starts on the cost lane (scorecard: Haiku 5.5; the fixture here), then Gemini as the volume lane.
    expect(ids(await connected.lanesFor(ask(org, 'extraction')))).toEqual(['fixture:synthetic-fixture', `google:${GEMINI}`]);
    // Not connected in this deployment (no key): skipped even though evaluated.
    expect(ids(await resolver({ providers: ['fixture'] }).lanesFor(ask(org, 'extraction')))).toEqual(['fixture:synthetic-fixture']);
    // An organization whose allow-list leaves Gemini out never gets it.
    const fixtureId = ((await call('GET', '/v1/admin/ai-models')).body['models'] as { id: string; providerModelId: string }[]).find((m) => m.providerModelId === 'synthetic-fixture')!.id;
    expect((await call('PUT', `/v1/admin/ai-models/organizations/${restricted.organizationId}`, { allowed: [fixtureId], routes: {} })).status).toBe(200);
    expect(ids(await connected.lanesFor(ask(restricted, 'extraction')))).toEqual(['fixture:synthetic-fixture']);
    // Terms withdrawn: Gemini stops at once.
    await call('PUT', '/v1/admin/ai-models/providers/google/terms', { dpaInPlace: true, zeroRetention: false });
    connected.invalidate();
    expect(ids(await connected.lanesFor(ask(org, 'extraction')))).toEqual(['fixture:synthetic-fixture']);
    await call('PUT', '/v1/admin/ai-models/providers/google/terms', { dpaInPlace: true, zeroRetention: true });
  });

  it('overrides come first: the console route for the job type, then MODEL_JOB_<JOB>; a cleared route returns the job to its chain', async () => {
    const lanes = resolver({ providers: ['fixture', 'google', 'anthropic'], jobOverrides: { document_qa: 'anthropic:claude-opus-5-5' } });
    expect(ids(await lanes.lanesFor(ask(org, 'document_qa')))).toEqual(['anthropic:claude-opus-5-5', `google:${GEMINI}`, 'fixture:synthetic-fixture']);
    const fixtureId = ((await call('GET', '/v1/admin/ai-models')).body['models'] as { id: string; providerModelId: string }[]).find((m) => m.providerModelId === 'synthetic-fixture')!.id;
    expect((await call('PUT', '/v1/admin/ai-models/routes/document_qa', { modelId: fixtureId })).status).toBe(200);
    lanes.invalidate();
    expect(ids(await lanes.lanesFor(ask(org, 'document_qa')))[0]).toBe('fixture:synthetic-fixture');
    expect((await call('DELETE', '/v1/admin/ai-models/routes/document_qa')).status).toBe(200);
    // The three roles always keep a model.
    expect((await call('DELETE', '/v1/admin/ai-models/routes/balanced')).body).toMatchObject({ code: 'ROUTE_REQUIRED' });
    lanes.invalidate();
    expect(ids(await lanes.lanesFor(ask(org, 'document_qa')))[0]).toBe('anthropic:claude-opus-5-5');
  });

  it('over the per-pact cost ceiling, economy lanes go first; Hosting cost splits AI spend by job type and by pact', async () => {
    await db.owner.query(`INSERT INTO cost_rates (kind, key, unit_price, effective_from) VALUES ('BEDROCK_INPUT_PER_MTOK', 'claude-opus-5-5', 15, '2026-01-01'), ('BEDROCK_OUTPUT_PER_MTOK', 'claude-opus-5-5', 75, '2026-01-01')`);
    const run = (job: string, tokens: number) =>
      db.owner.query(
        `INSERT INTO ai_runs (id, organization_id, deal_id, task_type, prompt_id, prompt_version, prompt_hash, model_alias, resolved_model_id, resolved_provider, job_type, input_hashes, status, repair_attempted, injection_signals, input_tokens, output_tokens, latency_ms, created_at)
         VALUES ($1, $2, $3, 'document.question', 'document.qa', '1', 'h', 'balanced', 'claude-opus-5-5', 'anthropic', $4, '{}', 'SUCCEEDED', false, 0, $5, $5, 10, now())`,
        [newId(), org.organizationId, org.dealId, job, tokens],
      );
    await run('document_qa', 1_000_000);
    await run('extraction', 200_000);
    // Spend so far: (1.2M x $15 + 1.2M x $75) / 1M = $108.
    const capped = resolver({ providers: ['fixture', 'google', 'anthropic'], jobOverrides: { document_qa: 'anthropic:claude-opus-5-5' }, ceilingUsd: 100 });
    expect(ids(await capped.lanesFor(ask(org, 'document_qa')))).toEqual([`google:${GEMINI}`, 'anthropic:claude-opus-5-5', 'fixture:synthetic-fixture']);
    const roomy = resolver({ providers: ['fixture', 'google', 'anthropic'], jobOverrides: { document_qa: 'anthropic:claude-opus-5-5' }, ceilingUsd: 500 });
    expect(ids(await roomy.lanesFor(ask(org, 'document_qa')))[0]).toBe('anthropic:claude-opus-5-5');

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const byJob = await call('GET', `/v1/admin/cost/metered/job?from=${today}&to=${tomorrow}`);
    expect(byJob.status, JSON.stringify(byJob.body)).toBe(200);
    expect((byJob.body['items'] as { key: string; ai: string }[]).map((row) => [row.key, Number(row.ai)])).toEqual([
      ['document_qa', 90],
      ['extraction', 18],
    ]);
    const byPactJob = await call('GET', `/v1/admin/cost/metered/pact_job?from=${today}&to=${tomorrow}`);
    expect((byPactJob.body['items'] as { label: string }[]).map((row) => row.label).sort()).toEqual([expect.stringMatching(/ · document_qa$/), expect.stringMatching(/ · extraction$/)]);
  });
});
