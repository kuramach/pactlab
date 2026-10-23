import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId, PACKS, type FindingRule } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { createFindingSchema } from './findings.schemas';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

/**
 * No pack ships finding rules before T-058, so a test-only rule exercises the
 * framework: it reads imported customer rows (pack-style evidence, no commit)
 * and flags the largest customer as a revenue-concentration drag.
 */
const CONCENTRATION_RULE: FindingRule = {
  id: 'test-customer-concentration',
  version: '1',
  evidenceTypes: ['billing.customer'],
  detect: (evidence) => {
    const ranked = [...evidence].sort((x, y) => Number(y.canonical['mrr'] ?? 0) - Number(x.canonical['mrr'] ?? 0));
    const top = ranked[0];
    return top
      ? [
          {
            key: top.sourceRecordId,
            domain: 'FINANCIAL',
            title: `Largest customer: ${top.sourceRecordId}`,
            description: 'Test rule: the largest customer by MRR.',
            severity: 'MEDIUM',
            confidence: 'HIGH',
            direction: -1,
            pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: '10000.00', high: '25000.00', basis: 'Test rule: churn of the largest customer' },
            evidenceIds: [top.id],
          },
        ]
      : [];
  },
};

describe('pack finding rules through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(method: 'GET' | 'POST', url: string, who: string, payload?: Body, headers: Record<string, string> = {}) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who] ?? ''}`, ...headers }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json() as Body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const identityVerifier = new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) });
    app = await createApp({
      prisma: db.prisma,
      identityVerifier,
      logger: createLogger('api-test', { level: 'silent' }),
      // The software pack (no seller type set) runs the test rule.
      packs: {
        packs: { ...PACKS, SOFTWARE_SAAS: { ...PACKS.SOFTWARE_SAAS, findingRules: [CONCENTRATION_RULE.id] } },
        rules: { [CONCENTRATION_RULE.id]: CONCENTRATION_RULE },
      },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
    for (const role of ['REVIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
    }
    const base = `/v1/deals/${a.dealId}`;
    const connection = await call('POST', `${base}/connections`, 'lead', {
      provider: 'csv',
      displayName: 'TroubledCo export',
      mode: 'FIXTURE',
      config: { datasets: ['TroubledCo/customers.csv'] },
    });
    await call('POST', `${base}/sync-runs`, 'lead', { connectionId: connection.body['id'] }, { 'idempotency-key': `sync-${newId()}` });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  const run = (who: string, deal = a.dealId) => call('POST', `/v1/deals/${deal}/findings/pack-rules/run`, who);

  it('proposes cited DRAFT findings without a commit, once — a re-run creates nothing new', async () => {
    const first = await run('lead');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ pack: 'SOFTWARE_SAAS', rules: [{ id: CONCENTRATION_RULE.id, version: '1' }], created: 1, existing: 0 });
    expect(first.body['evidenceRead']).toBeGreaterThan(1);
    expect((await run('lead')).body).toMatchObject({ created: 0, existing: 1 });

    const list = await call('GET', `/v1/deals/${a.dealId}/findings?domain=FINANCIAL`, 'lead');
    const items = list.body['items'] as { id: string; status: string; origin: string; direction: number; evidence: { commitSha: string | null; toolName: string }[] }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'DRAFT', origin: 'HEURISTIC', direction: -1 });
    expect(items[0]?.evidence[0]).toMatchObject({ commitSha: null, toolName: `pack-rule:${CONCENTRATION_RULE.id}` });
  });

  it('a person still decides: the pack finding is accepted only through review', async () => {
    const items = (await call('GET', `/v1/deals/${a.dealId}/findings?domain=FINANCIAL`, 'lead')).body['items'] as { id: string; version: number }[];
    const id = items[0]?.id ?? '';
    const submitted = await call('POST', `/v1/deals/${a.dealId}/findings/${id}/reviews`, 'lead', { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Concentration checked' });
    expect(submitted.status).toBe(201);
    const accepted = await call('POST', `/v1/deals/${a.dealId}/findings/${id}/reviews`, 'reviewer', {
      expectedVersion: 2,
      decision: 'ACCEPTED',
      rationale: 'Largest customer confirmed from the imported rows',
      direction: -1,
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body).toMatchObject({ finding: { status: 'ACCEPTED' } });
  });

  it('is refused to target contributors and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await run('target_contributor')).status);
    expect((await run('other')).status).toBe(404);
  });

  it('a technology finding still needs its commit; a pack finding cannot carry a repository path without one', async () => {
    const evidence = (await call('GET', `/v1/deals/${a.dealId}/evidence`, 'lead')).body['items'] as { id: string }[];
    const link = { evidenceItemId: evidence[0]?.id, commitSha: null, toolName: "manual", toolVersion: "1" };
    const draft = (domain: string, extra: Body = {}) => {
      const payload = {
        domain,
        title: 'Manual finding',
        description: 'Cites an imported row.',
        severity: 'LOW',
        confidence: 'MEDIUM',
        evidence: [{ ...link, ...extra }],
        pricedRisk: null,
      };
      // The request itself is well-formed; any refusal comes from the finding rules.
      expect(createFindingSchema.safeParse(payload).success).toBe(true);
      return call('POST', `/v1/deals/${a.dealId}/findings`, 'lead', payload);
    };
    // Rejected as invalid findings (the API answers finding validation errors with 400).
    expect((await draft('SECURITY')).body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect((await draft('COMMERCIAL', { path: 'billing/rules.ts' })).body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect((await draft('COMMERCIAL')).status).toBe(201);
  });
});
