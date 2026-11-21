import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiEnv } from '@pactlab/config';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
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
type Job = { jobType: string; source: string; lanes: { provider: string; modelId: string; available: boolean; reason: string | null }[] };
const GEMINI = 'gemini-3.1-pro-preview';

/** The routing diagram (Kumar, 2026-11-19): the platform's view for operators, each organization's for its admins. */
describe('AI routing diagram', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let operator: SyntheticTenant;
  let org: SyntheticTenant;
  let other: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  let geminiId: string;
  let fixtureId: string;
  const sign = (tenant: { subject: string; auth0OrganizationId: string }) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const job = (body: Body, jobType: string) => ((body['routing'] as { jobs: Job[] }).jobs.find((j) => j.jobType === jobType) as Job);

  beforeAll(async () => {
    db = await startTestDatabase();
    operator = await createSyntheticTenant(db.owner, 'Pactlab Ops');
    org = await createSyntheticTenant(db.owner, 'Routed');
    other = await createSyntheticTenant(db.owner, 'Other');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator.userId]);
    const ai = await createAiGateway({ AI_PROVIDER: 'fixture' } as ApiEnv, db.prisma);
    // As if Google's key were set (OpenAI's is not): Gemini lanes can serve once approved.
    const models: AiModelsRuntime = { ...(ai.models as AiModelsRuntime), resolver: new ModelRouteResolver(db.prisma, FIXTURE_ROUTES, Date.now, { providers: ['fixture', 'google'] }), providers: ['fixture', 'google'] };
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({ prisma: db.prisma, identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }), logger: createLogger('api-test', { level: 'silent' }), aiModels: models, aiStatus: ai.status });
    tokens['operator'] = await sign(operator);
    tokens['admin'] = await sign(org);
    tokens['other'] = await sign(other);
    tokens['member'] = await sign({ subject: (await addSyntheticDealMember(db.owner, org, 'ANALYST')).subject, auth0OrganizationId: org.auth0OrganizationId });

    // Gemini in the catalog, evaluated, terms recorded: Pactlab-approved for every organization.
    geminiId = (await call('operator', 'POST', '/v1/admin/ai-models', { provider: 'google', providerModelId: GEMINI, label: 'Gemini 3.1 Pro' })).body['id'] as string;
    await call('operator', 'PUT', '/v1/admin/ai-models/providers/google/terms', { dpaInPlace: true, zeroRetention: true });
    await call('operator', 'POST', `/v1/admin/ai-models/${geminiId}/evaluation`);
    for (let i = 0; i < 100 && !((await call('operator', 'GET', '/v1/admin/ai-models')).body['models'] as { id: string; status: string }[]).some((m) => m.id === geminiId && m.status === 'EVALUATED'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    fixtureId = ((await call('operator', 'GET', '/v1/admin/ai-models')).body['models'] as { id: string; providerModelId: string }[]).find((m) => m.providerModelId === 'synthetic-fixture')!.id;
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('operators see the platform diagram: every job, its lanes, and which cannot serve and why', async () => {
    expect((await call('admin', 'GET', '/v1/admin/ai-models/routing')).status).toBe(403);
    const platform = await call('operator', 'GET', '/v1/admin/ai-models/routing');
    expect(platform.status).toBe(200);
    expect((platform.body['routing'] as { jobs: Job[] }).jobs.map((j) => j.jobType).sort()).toEqual(['classification', 'contract_scrub', 'deep_review', 'document_qa', 'extraction', 'vision']);
    // Extraction routes on cost first (the scorecard: Haiku, here the fixture's fast role), then the Gemini volume lane.
    expect(job(platform.body, 'extraction')).toMatchObject({ source: 'REGISTRY', lanes: [{ provider: 'fixture', available: true }, { provider: 'google', modelId: GEMINI, label: 'Gemini 3.1 Pro', available: true }] });
    // OpenAI is not connected in this deployment: its lane shows, greyed, with the reason.
    expect(job(platform.body, 'contract_scrub').lanes[0]).toMatchObject({ provider: 'openai', available: false, reason: 'OpenAI not connected' });
    expect((platform.body['choices'] as { id: string }[]).map((c) => c.id)).toEqual(expect.arrayContaining([geminiId, fixtureId]));
  });

  it('every member sees the organization diagram; only owners and admins change it', async () => {
    const seen = await call('member', 'GET', '/v1/ai/routing');
    expect(seen.status).toBe(200);
    expect(seen.body['canEdit']).toBe(false);
    expect((await call('member', 'PUT', '/v1/ai/routing/extraction', { modelId: fixtureId })).status).toBe(403);
    const mine = await call('admin', 'GET', '/v1/ai/routing');
    expect(mine.body['canEdit']).toBe(true);
    expect((mine.body['choices'] as { id: string }[]).map((c) => c.id)).toEqual(expect.arrayContaining([geminiId, fixtureId]));
  });

  it('an admin routes a job to an approved model for the organization only; clearing returns it to the platform default', async () => {
    const saved = await call('admin', 'PUT', '/v1/ai/routing/extraction', { modelId: fixtureId });
    expect(saved.status).toBe(200);
    expect(job(saved.body, 'extraction')).toMatchObject({ source: 'ORGANIZATION', lanes: [{ provider: 'fixture' }, { provider: 'google' }] });
    const audit = (await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'org.ai_route_set' AND organization_id = $1`, [org.organizationId])) as { rows: { n: number }[] };
    expect(audit.rows[0]?.n).toBe(1);
    // Another organization is untouched.
    expect(job((await call('other', 'GET', '/v1/ai/routing')).body, 'extraction').source).toBe('REGISTRY');
    const cleared = await call('admin', 'PUT', '/v1/ai/routing/extraction', { modelId: null });
    expect(job(cleared.body, 'extraction').source).toBe('REGISTRY');
  });

  it('a model Pactlab has not approved for the organization is refused, and an operator allow-list narrows the choice', async () => {
    const added = await call('operator', 'POST', '/v1/admin/ai-models', { provider: 'google', providerModelId: 'gemini-3.8-flash', label: 'Gemini Flash' });
    expect((await call('admin', 'PUT', '/v1/ai/routing/classification', { modelId: added.body['id'] as string })).body).toMatchObject({ status: 422, code: 'NOT_ALLOWED' });
    expect((await call('operator', 'PUT', `/v1/admin/ai-models/organizations/${org.organizationId}`, { allowed: [fixtureId], routes: {} })).status).toBe(200);
    const narrowed = await call('admin', 'GET', '/v1/ai/routing');
    expect((narrowed.body['choices'] as { id: string }[]).map((c) => c.id)).toEqual([fixtureId]);
    expect((await call('admin', 'PUT', '/v1/ai/routing/extraction', { modelId: geminiId })).body).toMatchObject({ status: 422, code: 'NOT_ALLOWED' });
    // Off the allow-list, Gemini's lane is greyed for this organization.
    expect(job(narrowed.body, 'extraction').lanes.find((l) => l.provider === 'google')).toMatchObject({ available: false });
  });
});
