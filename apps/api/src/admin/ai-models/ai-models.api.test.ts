import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, documentQaPrompt, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import type { ApiEnv } from '@pactlab/config';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createAiGateway, type AiModelsRuntime } from '../../ai/ai-provider';
import { JwtIdentityVerifier } from '../../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;
type Model = { id: string; providerModelId: string; status: string; platformAliases: string[]; evaluation: Body | null; evaluatingSince: string | null };

/** T-130: AI models managed in the operator console: catalog, evaluation gate, routes per organization. */
describe('AI models in the admin console', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let models: AiModelsRuntime;
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
    const ai = await createAiGateway({ AI_PROVIDER: 'fixture' } as ApiEnv, db.prisma);
    models = ai.models as AiModelsRuntime;
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      aiModels: models,
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
    expect(await models.resolver.adopt('fixture')).toBe(0);
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
    expect((await call('operator', 'POST', '/v1/admin/ai-models', { provider: 'openai', providerModelId: 'gpt-next', label: 'GPT' })).body).toMatchObject({ code: 'PROVIDER_NOT_AVAILABLE' });

    // Not evaluated: it can be neither a platform route nor on an allow-list.
    expect((await call('operator', 'PUT', '/v1/admin/ai-models/routes/balanced', { modelId: id })).body).toMatchObject({ code: 'NOT_EVALUATED' });
    expect((await call('operator', 'PUT', `/v1/admin/ai-models/organizations/${restricted.organizationId}`, { allowed: [id], routes: {} })).body).toMatchObject({ code: 'NOT_EVALUATED' });

    expect((await call('operator', 'POST', `/v1/admin/ai-models/${id}/evaluation`)).status).toBe(202);
    const done = await evaluated(id);
    expect(done.status).toBe('EVALUATED');
    expect(done.evaluation).toMatchObject({ passed: true, citationRecall: 1, citationPrecision: 1 });
    expect(Object.keys(done.evaluation?.['promptHashes'] as Body).length).toBeGreaterThan(0);

    // The restricted organization: only the new model, which serves its deep reviews.
    const saved = await call('operator', 'PUT', `/v1/admin/ai-models/organizations/${restricted.organizationId}`, { allowed: [id], routes: { deep_review: id } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(await models.resolver.routeFor(restricted.organizationId, 'deep_review')).toMatchObject({ modelId: 'synthetic-next' });
    // Its other aliases: the platform default is not on its list, so they are refused, never sent to an excluded model.
    expect(await models.resolver.routeFor(restricted.organizationId, 'fast')).toBe('BLOCKED');
    // Everyone else is untouched.
    expect(await models.resolver.routeFor(other.organizationId, 'deep_review')).toMatchObject({ modelId: 'synthetic-fixture' });

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
});
