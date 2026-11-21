import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, documentQaPrompt, FixtureBedrockCatalog, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import type { ApiEnv } from '@pactlab/config';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createAiGateway, type AiModelsRuntime } from '../../ai/ai-provider';
import { staleOn } from './ai-models.service';
import { JwtIdentityVerifier } from '../../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;
type Model = { id: string; providerModelId: string; status: string; platformAliases: string[]; evaluation: Body | null; evaluatingSince: string | null };

/** T-131: AI models managed in the operator console: catalog, evaluation gate, routes per organization. */
describe('AI models in the admin console', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let models: AiModelsRuntime;
  let ai: Awaited<ReturnType<typeof createAiGateway>>;
  let operator: SyntheticTenant;
  let restricted: SyntheticTenant;
  let other: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const sign = (tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const catalog = async () => ((await call('operator', 'GET', '/v1/admin/ai-models')).body['models'] as Model[]);
  async function evaluated(id: string) {
    for (let i = 0; i < 100; i += 1) {
      const model = (await catalog()).find((entry) => entry.id === id);
      if (model && !model.evaluatingSince) return model;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('evaluation did not finish');
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    operator = await createSyntheticTenant(db.owner, 'Pactlab Ops');
    restricted = await createSyntheticTenant(db.owner, 'Restricted');
    other = await createSyntheticTenant(db.owner, 'Other');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator.userId]);
    // The fixture provider: the configured models are adopted, evaluations replay the recorded cassettes.
    ai = await createAiGateway({ AI_PROVIDER: 'fixture' } as ApiEnv, db.prisma);
    // As if OpenAI's key were set: the console offers it, and the terms gate decides whether it may run.
    models = {
      ...(ai.models as AiModelsRuntime),
      providers: ['fixture', 'openai', 'bedrock'],
      // What Bedrock lists for the account (Add from Bedrock): a scorecard pick in two jobs, one in another, and one it doesn't name.
      bedrock: new FixtureBedrockCatalog([
        { modelId: 'us.anthropic.claude-haiku-5-5', maker: 'Anthropic', name: 'Claude Haiku 5.5', readsImages: true },
        { modelId: 'openai.gpt-5-5-v1:0', maker: 'OpenAI', name: 'GPT-5.5', readsImages: false },
        { modelId: 'meta.llama4-maverick-17b-instruct-v1:0', maker: 'Meta', name: 'Llama 4 Maverick 17B Instruct', readsImages: true },
      ]),
    };
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      aiModels: models,
      aiStatus: ai.status,
    });
    for (const [name, tenant] of [['operator', operator], ['restricted', restricted], ['other', other]] as const) tokens[name] = await sign(tenant);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('adopts the configured models at boot: evaluated, serving every alias, so nothing changes on deploy', async () => {
    const adopted = await catalog();
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toMatchObject({ providerModelId: 'synthetic-fixture', status: 'EVALUATED', platformAliases: ['balanced', 'deep_review', 'fast'] });
    expect(await models.resolver.routeFor(other.organizationId, 'balanced')).toMatchObject({ modelId: 'synthetic-fixture', provider: 'fixture', effort: 'low' });
    // Adopting again adds nothing.
    const before = ((await call('operator', 'GET', '/v1/admin/ai-models')).body['models'] as unknown[]).length;
    await models.resolver.adopt('fixture');
    expect(((await call('operator', 'GET', '/v1/admin/ai-models')).body['models'] as unknown[]).length).toBe(before);
  });

  it('is for platform operators only', async () => {
    expect((await call('restricted', 'GET', '/v1/admin/ai-models')).status).toBe(403);
    expect((await call('restricted', 'POST', '/v1/admin/ai-models', { provider: 'fixture', providerModelId: 'x-model', label: 'X' })).status).toBe(403);
    expect((await call('restricted', 'PUT', `/v1/admin/ai-models/organizations/${restricted.organizationId}`, { allowed: [], routes: {} })).status).toBe(403);
  });

  it('a new model serves only after it passes evaluation; then an organization can be limited to it', async () => {
    const added = await call('operator', 'POST', '/v1/admin/ai-models', { provider: 'fixture', providerModelId: 'synthetic-next', label: 'Synthetic next' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const id = added.body['id'] as string;
    expect((await call('operator', 'POST', '/v1/admin/ai-models', { provider: 'fixture', providerModelId: 'synthetic-next', label: 'Again' })).body).toMatchObject({ code: 'MODEL_EXISTS' });
    // Providers this deployment cannot call are refused (they arrive with their transports).
    expect((await call('operator', 'POST', '/v1/admin/ai-models', { provider: 'google', providerModelId: 'gemini-next', label: 'Gemini' })).body).toMatchObject({ code: 'PROVIDER_NOT_AVAILABLE' });
    // A Claude Bedrock ID with a dotted version (claude-opus-5.5) is a typo: refused before it can only fail evaluation.
    expect((await call('operator', 'POST', '/v1/admin/ai-models', { provider: 'bedrock', providerModelId: 'us.anthropic.claude-opus-5.5', label: 'Claude Opus 5.5' })).body).toMatchObject({ code: 'BEDROCK_ID_FORMAT' });

    // Not evaluated: it can be neither a platform route nor on an allow-list.
    expect((await call('operator', 'PUT', '/v1/admin/ai-models/routes/balanced', { modelId: id })).body).toMatchObject({ code: 'NOT_EVALUATED' });
    expect((await call('operator', 'PUT', `/v1/admin/ai-models/organizations/${restricted.organizationId}`, { allowed: [id], routes: {} })).body).toMatchObject({ code: 'NOT_EVALUATED' });

    expect((await call('operator', 'POST', `/v1/admin/ai-models/${id}/evaluation`)).status).toBe(202);
    const done = await evaluated(id);
    expect(done.status).toBe('EVALUATED');
    // The health check (2026-11-20): it answered with a valid cited answer; nothing falls due on prompt changes.
    expect((done as Model & { reevaluationDue: boolean }).reevaluationDue).toBe(false);
    expect(done.evaluation).toMatchObject({ kind: 'health', passed: true });

    // The restricted organization: only the new model, which serves its deep reviews.
    const saved = await call('operator', 'PUT', `/v1/admin/ai-models/organizations/${restricted.organizationId}`, { allowed: [id], routes: { deep_review: id } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(await models.resolver.routeFor(restricted.organizationId, 'deep_review')).toMatchObject({ modelId: 'synthetic-next' });
    // Its other aliases: the platform default is not on its list, so they are refused, never sent to an excluded model.
    expect(await models.resolver.routeFor(restricted.organizationId, 'fast')).toBe('BLOCKED');
    // Everyone else is untouched.
    expect(await models.resolver.routeFor(other.organizationId, 'deep_review')).toMatchObject({ modelId: 'synthetic-fixture' });
    // What the organization's people see as their models: the catalog names, and no row for a refused role.
    const status = (await call('restricted', 'GET', '/v1/ai/status')).body as { routes: { alias: string; label: string }[] };
    expect(status.routes).toEqual([expect.objectContaining({ alias: 'deep_review', modelId: 'synthetic-next', label: 'Synthetic next' })]);

    // Retiring: refused while a platform route uses it; organization routes to it stop at once.
    const adoptedId = (await catalog()).find((entry) => entry.providerModelId === 'synthetic-fixture')!.id;
    expect((await call('operator', 'POST', `/v1/admin/ai-models/${adoptedId}/retire`)).body).toMatchObject({ code: 'MODEL_IN_USE' });
    expect((await call('operator', 'POST', `/v1/admin/ai-models/${id}/retire`)).status).toBe(200);
    expect(await models.resolver.routeFor(restricted.organizationId, 'deep_review')).toBe('BLOCKED');
    const audited = await db.owner.query<{ action: string }>(`SELECT DISTINCT action FROM audit_events WHERE action LIKE 'operator.ai_%' OR action = 'org.ai_models_set'`);
    expect(new Set(audited.rows.map((row) => row.action))).toEqual(
      new Set(['operator.ai_model.added', 'operator.ai_model.evaluation_started', 'operator.ai_model.evaluation_passed', 'operator.ai_model.retired', 'org.ai_models_set']),
    );
  });

  it('the gateway refuses a blocked alias and records the provider of every run', async () => {
    const transport = new ScriptedModelTransport(() => '{"answer":"x","citations":[]}');
    const gateway = new TransportClaudeGateway({
      transport,
      registry: defaultPromptRegistry(),
      routeFor: async (organizationId, alias) => (organizationId === restricted.organizationId ? 'BLOCKED' : { modelId: 'synthetic-fixture', provider: 'fixture', effort: alias === 'fast' ? 'low' : 'medium' }),
    });
    const request = { dealId: other.dealId, inputs: [{ text: 'q', classification: 'BUSINESS' as const }] };
    await expect(gateway.invoke(documentQaPrompt, { ...request, organizationId: restricted.organizationId })).rejects.toMatchObject({ code: 'NO_APPROVED_MODEL' });
    const response = await gateway.invoke(documentQaPrompt, { ...request, organizationId: other.organizationId });
    expect(response.run).toMatchObject({ resolvedModelId: 'synthetic-fixture', resolvedProvider: 'fixture' });
    expect(transport.requests[0]).toMatchObject({ modelId: 'synthetic-fixture', provider: 'fixture' });
  });

  it('another cloud (ADR 0034): no evaluation and no serving until its data terms are on record; withdrawn terms stop it at once', async () => {
    const added = await call('operator', 'POST', '/v1/admin/ai-models', { provider: 'openai', providerModelId: 'gpt-synthetic', label: 'GPT (synthetic)' });
    const id = added.body['id'] as string;
    // No terms: not even synthetic test material is sent.
    expect((await call('operator', 'POST', `/v1/admin/ai-models/${id}/evaluation`)).body).toMatchObject({ code: 'EVALUATION_NOT_STARTED' });
    // A data-processing agreement alone is not enough.
    expect((await call('operator', 'PUT', '/v1/admin/ai-models/providers/openai/terms', { dpaInPlace: true, zeroRetention: false })).body).toEqual({ cleared: false });
    expect((await call('operator', 'POST', `/v1/admin/ai-models/${id}/evaluation`)).body).toMatchObject({ code: 'EVALUATION_NOT_STARTED' });
    expect((await call('restricted', 'PUT', '/v1/admin/ai-models/providers/openai/terms', { dpaInPlace: true, zeroRetention: true })).status).toBe(403);

    expect((await call('operator', 'PUT', '/v1/admin/ai-models/providers/openai/terms', { dpaInPlace: true, zeroRetention: true, region: 'US', notes: 'Synthetic test terms' })).body).toEqual({ cleared: true });
    expect((await call('operator', 'POST', `/v1/admin/ai-models/${id}/evaluation`)).status).toBe(202);
    expect((await evaluated(id)).status).toBe('EVALUATED');
    expect((await call('operator', 'PUT', `/v1/admin/ai-models/organizations/${other.organizationId}`, { allowed: [], routes: { balanced: id } })).status).toBe(200);
    expect(await models.resolver.routeFor(other.organizationId, 'balanced')).toMatchObject({ modelId: 'gpt-synthetic', provider: 'openai' });
    const terms = (await call('operator', 'GET', '/v1/admin/ai-models')).body['terms'] as Body[];
    expect(terms).toEqual([expect.objectContaining({ provider: 'openai', cleared: true, region: 'US' })]);

    // Terms withdrawn: the organization falls back to the platform default within the request.
    await call('operator', 'PUT', '/v1/admin/ai-models/providers/openai/terms', { dpaInPlace: true, zeroRetention: false });
    expect(await models.resolver.routeFor(other.organizationId, 'balanced')).toMatchObject({ modelId: 'synthetic-fixture' });
    const audited = await db.owner.query<{ action: string }>(`SELECT DISTINCT action FROM audit_events WHERE action LIKE 'operator.ai_provider.%'`);
    expect(new Set(audited.rows.map((row) => row.action))).toEqual(new Set(['operator.ai_provider.cleared', 'operator.ai_provider.not_cleared']));
  });

  it('Add from Bedrock is led by the model scorecard: each job\'s picks with score and cost, marked available, in use or not on Bedrock', async () => {
    expect((await call('other', 'GET', '/v1/admin/ai-models/bedrock')).status).toBe(403);
    const listed = (await call('operator', 'GET', '/v1/admin/ai-models/bedrock')).body as { connected: boolean; scorecard: { asOf: string; jobs: { job: string; picks: { name: string; costPerTask: string | null; bedrockModelId: string | null; inUse: unknown }[] }[] }; items: { modelId: string }[] };
    expect(listed.connected).toBe(true);
    expect(listed.scorecard.asOf).toBe('2026-11-20');
    const extraction = listed.scorecard.jobs.find((job) => job.job === 'extraction')!;
    expect(extraction.picks[0]).toMatchObject({ name: 'Claude Haiku 5.5', costPerTask: '$0.20', bedrockModelId: 'us.anthropic.claude-haiku-5-5', inUse: null });
    // Not on this account's Bedrock: shown, with nothing to use.
    expect(extraction.picks.find((pick) => pick.name === 'Gemini 3.1 Pro')).toMatchObject({ bedrockModelId: null, inUse: null });
    expect(listed.scorecard.jobs.find((job) => job.job === 'contract_scrub')?.picks[0]).toMatchObject({ name: 'GPT-5.5', bedrockModelId: 'openai.gpt-5-5-v1:0' });
    // Everything else Bedrock lists, minus the scorecard's picks.
    expect(listed.items.map((model) => model.modelId)).toEqual(['meta.llama4-maverick-17b-instruct-v1:0']);
  });

  it('Use adds a Bedrock model and checks it; only models Bedrock lists can be used', async () => {
    expect((await call('operator', 'POST', '/v1/admin/ai-models/bedrock', { modelId: 'us.anthropic.claude-made-up-9' })).body).toMatchObject({ code: 'NOT_ON_BEDROCK' });
    const used = await call('operator', 'POST', '/v1/admin/ai-models/bedrock', { modelId: 'us.anthropic.claude-haiku-5-5' });
    expect(used.status, JSON.stringify(used.body)).toBe(202);
    for (let i = 0; i < 100 && (await catalog()).find((m) => m.providerModelId === 'us.anthropic.claude-haiku-5-5')?.status !== 'EVALUATED'; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await catalog()).find((m) => m.providerModelId === 'us.anthropic.claude-haiku-5-5')).toMatchObject({ provider: 'bedrock', label: 'Claude Haiku 5.5', status: 'EVALUATED' });
    const after = (await call('operator', 'GET', '/v1/admin/ai-models/bedrock')).body as { scorecard: { jobs: { job: string; picks: { name: string; inUse: unknown; bedrockModelId: string | null }[] }[] } };
    expect(after.scorecard.jobs.find((job) => job.job === 'fast')?.picks[0]).toMatchObject({ name: 'Claude Haiku 5.5', inUse: { ready: true }, bedrockModelId: null });
  });

  it('re-evaluation is due when a prompt changed or was added since the evaluation, never for an adopted baseline', () => {
    expect(staleOn(undefined)).toBe(false);
    expect(staleOn({ 'document-qa@1': 'old-hash' })).toBe(true);
  });
});
