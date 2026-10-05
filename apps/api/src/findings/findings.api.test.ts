import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { GitHubFixtureAdapter, readAllCommits } from '@pactlab/connectors';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import {
  analyseKeyPersonRisk,
  detectGhostCommits,
  ghostCommitFinding,
  keyPersonFindings,
  newId,
  type Finding,
  type FindingReview,
  type TenantContext,
} from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { FindingsService } from './findings.service';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Body = Record<string, unknown>;

describe('findings API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const users: Record<string, { userId: string; context: TenantContext }> = {};
  let evidenceId: string;
  let headSha: string;

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
    target: NestFastifyApplication,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    bearer: string,
    payload?: Body,
    headers: Record<string, string> = {},
  ) {
    const response = await target.inject({
      method,
      url,
      headers: { authorization: `Bearer ${bearer}`, ...headers },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Body };
  }

  const as = (who: string, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: Body) =>
    call(app, method, `/v1/deals/${a.dealId}/findings${path}`, tokens[who]!, payload);

  const link = () => ({
    evidenceItemId: evidenceId,
    commitSha: headSha,
    toolName: 'semgrep',
    toolVersion: '1.0.0-fixture',
    rulesetVersion: 'pactlab-fixture-rules@1',
    path: 'billing/rules.ts',
    lineStart: 3,
    lineEnd: 3,
  });

  const draftBody = (overrides: Body = {}) => ({
    domain: 'SECURITY',
    title: 'Dynamic evaluation in billing rules',
    description: 'Rule engine evaluates runtime input.',
    severity: 'HIGH',
    confidence: 'HIGH',
    evidence: [link()],
    pricedRisk: {
      type: 'REMEDIATION_COST',
      currency: 'USD',
      low: '40000',
      high: '120000.00',
      basis: 'Rewrite estimate',
    },
    ...overrides,
  });

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
    const logger = createLogger('api-test', { level: 'silent' });
    // The production AppModule: findings persist through the RLS-backed repository.
    app = await createApp({ prisma: db.prisma, identityVerifier, logger });

    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    users['lead'] = { userId: a.userId, context: a.context };
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
    for (const role of ['ANALYST', 'REVIEWER', 'VIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
      users[role.toLowerCase()] = member;
    }

    // Evidence through the real spine: fixture connection plus idempotent sync.
    const base = `/v1/deals/${a.dealId}`;
    const connection = await call(app, 'POST', `${base}/connections`, tokens['lead']!, {
      provider: 'csv',
      displayName: 'TroubledCo export',
      mode: 'FIXTURE',
      config: { datasets: ['TroubledCo/customers.csv'] },
    });
    await call(
      app,
      'POST',
      `${base}/sync-runs`,
      tokens['lead']!,
      { connectionId: connection.body['id'] },
      {
        'idempotency-key': `sync-${newId()}`,
      },
    );
    const items = (await call(app, 'GET', `${base}/evidence`, tokens['lead']!)).body['items'] as {
      id: string;
    }[];
    evidenceId = items[0]!.id;

    const scope = {
      organizationId: a.organizationId,
      dealId: a.dealId,
      connectionId: newId(),
      credentialRef: null,
    };
    headSha = (await new GitHubFixtureAdapter({ repository: 'troubledco/core' }).head(scope))
      .headSha;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('accepted finding resolves to commit hash, tool version and evidence item via a human review', async () => {
    const created = await as('analyst', 'POST', '', draftBody());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'DRAFT', origin: 'HUMAN', version: 1 });
    const id = created.body['id'] as string;

    const submitted = await as('analyst', 'POST', `/${id}/reviews`, {
      expectedVersion: 1,
      decision: 'SUBMITTED',
      rationale: 'Ready for technical review',
    });
    expect(submitted.status).toBe(201);

    expect(
      (
        await as('analyst', 'POST', `/${id}/reviews`, {
          expectedVersion: 2,
          decision: 'ACCEPTED',
          rationale: 'self-approve',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await as('reviewer', 'POST', `/${id}/reviews`, {
          expectedVersion: 1,
          decision: 'ACCEPTED',
          rationale: 'stale',
        })
      ).status,
    ).toBe(409);

    const accepted = await as('reviewer', 'POST', `/${id}/reviews`, {
      expectedVersion: 2,
      decision: 'ACCEPTED',
      rationale: 'Confirmed at the scanned commit',
    });
    expect(accepted.status).toBe(201);

    const detail = await as('lead', 'GET', `/${id}`);
    expect(detail.status).toBe(200);
    const finding = detail.body['finding'] as Finding;
    expect(finding.status).toBe('ACCEPTED');
    expect(finding.evidence[0]).toMatchObject({
      commitSha: headSha,
      toolVersion: '1.0.0-fixture',
      evidenceItemId: evidenceId,
    });
    // numeric(19,4) round-trips as an exact, minimal decimal string.
    expect(finding.pricedRisk).toMatchObject({ currency: 'USD', low: '40000', high: '120000' });
    const reviews = detail.body['reviews'] as FindingReview[];
    expect(reviews.map((review) => [review.decision, review.reviewerUserId])).toEqual([
      ['SUBMITTED', users['analyst']!.userId],
      ['ACCEPTED', users['reviewer']!.userId],
    ]);
    const lineage = await call(
      app,
      'GET',
      `/v1/deals/${a.dealId}/evidence/${evidenceId}/lineage`,
      tokens['lead']!,
    );
    expect(lineage.status).toBe(200);

    expect(
      (
        await as('reviewer', 'POST', `/${id}/reviews`, {
          expectedVersion: 3,
          decision: 'REJECTED',
          rationale: 'x',
        })
      ).status,
    ).toBe(409);
    expect(
      (await as('analyst', 'PATCH', `/${id}`, { expectedVersion: 3, severity: 'LOW' })).status,
    ).toBe(409);
    const audits = (await db.owner.query(
      `SELECT action FROM audit_events WHERE target_id = $1 AND outcome = 'SUCCEEDED' ORDER BY chain_seq`,
      [id],
    )) as { rows: { action: string }[] };
    expect(audits.rows.map((row) => row.action)).toEqual([
      'finding.created',
      'finding.submitted',
      'finding.accepted',
    ]);
    const outbox = (await db.owner.query(
      `SELECT event_type FROM outbox_events WHERE aggregate_id = $1 ORDER BY created_at, event_type`,
      [id],
    )) as { rows: { event_type: string }[] };
    expect(outbox.rows.map((row) => row.event_type).sort()).toEqual([
      'finding.accepted',
      'finding.submitted',
    ]);
    const denied = (await db.owner.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id = $1 AND action = 'finding.accepted' AND outcome = 'DENIED'`,
      [users['analyst']!.userId],
    )) as { rows: { n: number }[] };
    expect(denied.rows[0]?.n).toBe(1);
  });

  it('rejects unresolvable evidence, floating-point money and acceptance without evidence', async () => {
    expect(
      (
        await as(
          'analyst',
          'POST',
          '',
          draftBody({ evidence: [{ ...link(), evidenceItemId: newId() }] }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await as(
          'analyst',
          'POST',
          '',
          draftBody({
            pricedRisk: { type: 'ESCROW', currency: 'USD', low: 1.5, high: '2', basis: 'x' },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await as('analyst', 'POST', '', draftBody({ evidence: [{ ...link(), commitSha: 'main' }] })))
        .status,
    ).toBe(400);

    const bare = await as('analyst', 'POST', '', draftBody({ evidence: [] }));
    const id = bare.body['id'] as string;
    await as('analyst', 'POST', `/${id}/reviews`, {
      expectedVersion: 1,
      decision: 'SUBMITTED',
      rationale: 'r',
    });
    expect(
      (
        await as('reviewer', 'POST', `/${id}/reviews`, {
          expectedVersion: 2,
          decision: 'ACCEPTED',
          rationale: 'ok',
        })
      ).status,
    ).toBe(422);
    const back = await as('reviewer', 'POST', `/${id}/reviews`, {
      expectedVersion: 2,
      decision: 'SUPPORT_REQUESTED',
      rationale: 'Attach the scan evidence',
    });
    expect(back.status).toBe(201);
    const edited = await as('analyst', 'PATCH', `/${id}`, {
      expectedVersion: 3,
      evidence: [link()],
    });
    expect(edited.body).toMatchObject({ status: 'DRAFT', version: 4 });
  });

  it('keeps findings away from target contributors, other tenants and read-only roles', async () => {
    expect((await as('target_contributor', 'GET', '')).status).toBe(403);
    expect((await as('viewer', 'GET', '')).status).toBe(200);
    expect((await as('viewer', 'POST', '', draftBody())).status).toBe(403);
    expect((await as('other', 'GET', '')).status).toBe(404);
    expect((await as('other', 'POST', '', draftBody())).status).toBe(404);
    const anyId = (
      (await db.owner.query(`SELECT id FROM findings WHERE deal_id = $1 LIMIT 1`, [a.dealId])) as {
        rows: { id: string }[];
      }
    ).rows[0]!.id;
    expect((await as('other', 'GET', `/${anyId}`)).status).toBe(404);
  });

  it('TroubledCo ghost commits and key-person concentration land as idempotent DRAFTs', async () => {
    const adapter = new GitHubFixtureAdapter({ repository: 'troubledco/core' });
    const scope = {
      organizationId: a.organizationId,
      dealId: a.dealId,
      connectionId: newId(),
      credentialRef: null,
    };
    const commits = await readAllCommits(adapter, scope);
    const source = { evidenceItemId: evidenceId, headCommitSha: headSha };
    const proposals = [
      ghostCommitFinding(detectGhostCommits(commits, await adapter.identityMap(scope)), source)!,
      ...keyPersonFindings(analyseKeyPersonRisk(commits), source),
    ];
    const service = app.get(FindingsService);
    const actor = { kind: 'SYSTEM', component: 'scanner-orchestrator' } as const;
    const analyst = users['analyst']!.context;
    const first = await service.recordProposals(analyst, a.dealId, proposals, actor, 'req-1');
    expect(first.created.map((f) => [f.domain, f.status])).toEqual([
      ['CODE_PROVENANCE', 'DRAFT'],
      ['KEY_PERSON', 'DRAFT'],
    ]);
    const replay = await service.recordProposals(analyst, a.dealId, proposals, actor, 'req-2');
    expect(replay).toEqual({ created: [], existing: 2 });

    const drafts = await as('lead', 'GET', '?status=DRAFT&domain=CODE_PROVENANCE');
    expect((drafts.body['items'] as Finding[]).map((f) => f.title)).toEqual([
      '11 commits attributed to unmatched or departed identities',
    ]);
  });
});
