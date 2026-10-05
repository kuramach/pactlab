import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { GitHubFixtureAdapter } from '@pactlab/connectors';
import { PrismaFindingsRepository } from '../findings/prisma-findings.repository';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { newId, type Finding, type TenantContext } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type {
  Scenario,
  Submission,
  SubmissionDecision,
  ValuationRun,
} from './valuation.repository';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Body = Record<string, unknown>;

interface ScenarioView {
  scenario: Scenario;
  latestRun: ValuationRun | null;
  stale: boolean | null;
  staleReasons: { kind: string; findingId?: string }[];
  submissions: Omit<Submission, 'canonical'>[];
  decisions: SubmissionDecision[];
}

describe('valuation API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let findingsRepo: PrismaFindingsRepository;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let c: SyntheticTenant;
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

  async function raw(
    target: NestFastifyApplication,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    bearer: string,
    payload?: Body,
    headers: Record<string, string> = {},
  ) {
    return target.inject({
      method,
      url,
      headers: { authorization: `Bearer ${bearer}`, ...headers },
      ...(payload ? { payload } : {}),
    });
  }

  async function call(
    target: NestFastifyApplication,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    bearer: string,
    payload?: Body,
    headers: Record<string, string> = {},
  ) {
    const response = await raw(target, method, url, bearer, payload, headers);
    return { status: response.statusCode, body: response.json() as Body };
  }

  const scenarios = (path = '', deal = () => a.dealId) =>
    `/v1/deals/${deal()}/valuation/scenarios${path}`;
  const as = (who: string, method: 'GET' | 'POST' | 'PUT', path: string, payload?: Body) =>
    call(app, method, scenarios(path), tokens[who]!, payload);
  const view = (response: { body: Body }) => response.body as unknown as ScenarioView;

  const values = (overrides: Body = {}) => ({
    assumptions: { method: 'ARR_MULTIPLE', arr: '10000000.00', multiple: '6.5' },
    bridge: {
      cash: '2000000',
      debt: '5000000',
      debtLikeItems: '500000',
      workingCapitalAdjustment: '-250000',
    },
    ...overrides,
  });

  /** A finding drafted, submitted and accepted through the real findings API. */
  async function acceptedFinding(pricedRisk: Body) {
    const findings = (who: string, path: string, payload: Body) =>
      call(app, 'POST', `/v1/deals/${a.dealId}/findings${path}`, tokens[who]!, payload);
    const created = await findings('analyst', '', {
      domain: 'OSS_LICENSE',
      title: 'Copyleft dependency in shipped binary',
      description: 'AGPL component linked into the on-premise agent.',
      severity: 'HIGH',
      confidence: 'HIGH',
      evidence: [
        {
          evidenceItemId: evidenceId,
          commitSha: headSha,
          toolName: 'cyclonedx',
          toolVersion: '1.0.0-fixture',
          rulesetVersion: null,
          path: null,
          lineStart: null,
          lineEnd: null,
        },
      ],
      pricedRisk,
    });
    const id = created.body['id'] as string;
    await findings('analyst', `/${id}/reviews`, {
      expectedVersion: 1,
      decision: 'SUBMITTED',
      rationale: 'Ready',
    });
    const accepted = await findings('reviewer', `/${id}/reviews`, {
      expectedVersion: 2,
      decision: 'ACCEPTED',
      rationale: 'Confirmed in SBOM',
    });
    expect(accepted.status).toBe(201);
    return id;
  }

  /**
   * Re-price an accepted risk. The findings workflow has no reopen command
   * yet, so this goes through the persistence port the way a future
   * re-pricing command would: new version, new priced risk.
   */
  async function repriceFinding(findingId: string, high: string) {
    const lead = users['lead']!.context;
    const { finding } = (await findingsRepo.get(lead, a.dealId, findingId))!;
    const next: Finding = {
      ...finding,
      pricedRisk: { ...finding.pricedRisk!, high },
      version: finding.version + 1,
    };
    expect(
      await findingsRepo.update(lead, next, finding.version, null, {
        organizationId: a.organizationId,
        dealId: a.dealId,
        actorUserId: lead.userId,
        action: 'finding.repriced',
        targetType: 'finding',
        targetId: findingId,
        outcome: 'SUCCEEDED',
      }),
    ).toBe(true);
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    c = await createSyntheticTenant(db.owner, 'Charlie');
    await db.owner.query(`UPDATE deals SET transaction_type = 'TAKE_PRIVATE' WHERE id = $1`, [
      c.dealId,
    ]);
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const identityVerifier = new JwtIdentityVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: createLocalJWKSet({ keys: [jwk] }),
    });
    const logger = createLogger('api-test', { level: 'silent' });
    // The production AppModule: findings and valuation persist through RLS.
    app = await createApp({ prisma: db.prisma, identityVerifier, logger });
    findingsRepo = new PrismaFindingsRepository(db.prisma);

    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    users['lead'] = { userId: a.userId, context: a.context };
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
    tokens['charlie'] = await token(c.subject, c.auth0OrganizationId);
    for (const role of ['ANALYST', 'REVIEWER', 'VIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
      users[role.toLowerCase()] = member;
    }

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
      { 'idempotency-key': `sync-${newId()}` },
    );
    const items = (await call(app, 'GET', `${base}/evidence`, tokens['lead']!)).body['items'] as {
      id: string;
    }[];
    evidenceId = items[0]!.id;
    headSha = (
      await new GitHubFixtureAdapter({ repository: 'troubledco/core' }).head({
        organizationId: a.organizationId,
        dealId: a.dealId,
        connectionId: newId(),
        credentialRef: null,
      })
    ).headSha;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('changing an accepted risk marks dependent scenarios stale until re-run', async () => {
    const findingId = await acceptedFinding({
      type: 'PRICE_REDUCTION',
      currency: 'USD',
      low: '1000000',
      high: '3000000',
      basis: 'Relicensing or replacement estimate',
    });
    const created = await as('analyst', 'POST', '', {
      name: 'Base case',
      values: values({ findingLinks: [{ findingId, point: 'MID' }] }),
    });
    expect(created.status).toBe(201);
    const scenario = view(created).scenario;
    expect(scenario).toMatchObject({
      status: 'DRAFT',
      currency: 'USD',
      transactionType: 'PRIVATE_ACQUIRER',
      assumptionVersion: 1,
    });
    expect(view(created).stale).toBeNull();

    const ran = await as('analyst', 'POST', `/${scenario.id}/runs`, { expectedVersion: 1 });
    expect(ran.status).toBe(201);
    const run = view(ran).latestRun!;
    expect(view(ran).stale).toBe(false);
    expect(run.inputs.adjustments).toEqual([
      expect.objectContaining({ findingId, findingVersion: 3, point: 'MID' }),
    ]);
    expect(run.result.enterpriseValue.amount).toBe('65000000.00');
    expect(run.result.bridge.equityPurchasePrice.amount).toBe('59250000.00');
    expect(
      run.result.bridge.lines.find((line) => line.kind === 'FINDING_ADJUSTMENT'),
    ).toMatchObject({ findingId, amount: { amount: '-2000000.00' } });

    await repriceFinding(findingId, '5000000');
    const stale = view(await as('lead', 'GET', `/${scenario.id}`));
    expect(stale.stale).toBe(true);
    expect(stale.staleReasons).toEqual([{ kind: 'FINDING_CHANGED', findingId }]);
    const listed = (await as('viewer', 'GET', '')).body['items'] as ScenarioView[];
    expect(listed.find((item) => item.scenario.id === scenario.id)?.stale).toBe(true);

    // A stale result cannot be submitted; a re-run picks up the new price.
    expect((await as('analyst', 'POST', `/${scenario.id}/submissions`, { expectedVersion: 2 })).status).toBe(409);
    const rerun = view(await as('analyst', 'POST', `/${scenario.id}/runs`, { expectedVersion: 2 }));
    expect(rerun.stale).toBe(false);
    expect(rerun.latestRun!.result.bridge.equityPurchasePrice.amount).toBe('58250000.00');

    // New assumptions also leave the last result stale.
    const edited = await as('analyst', 'PUT', `/${scenario.id}/assumptions`, {
      expectedVersion: 3,
      values: values({ findingLinks: [{ findingId, point: 'HIGH' }] }),
    });
    expect(edited.status).toBe(200);
    expect(view(edited).scenario.assumptionVersion).toBe(2);
    expect(view(edited).staleReasons).toEqual([{ kind: 'ASSUMPTIONS_CHANGED' }]);
  });

  it('a frozen valuation submission is byte-identical on re-read and immutable', async () => {
    const findingId = await acceptedFinding({
      type: 'ESCROW',
      currency: 'USD',
      low: '500000',
      high: '750000',
      basis: 'Licence exposure holdback',
    });
    const created = view(
      await as('lead', 'POST', '', {
        name: 'Submission case',
        values: values({
          findingLinks: [{ findingId, point: 'HIGH' }],
          sensitivity: {
            rows: { variable: 'arr', values: ['9000000', '10000000'] },
            columns: { variable: 'multiple', values: ['6', '6.5'] },
          },
        }),
      }),
    );
    const id = created.scenario.id;
    await as('lead', 'POST', `/${id}/runs`, { expectedVersion: 1 });
    const submitted = await as('lead', 'POST', `/${id}/submissions`, { expectedVersion: 2 });
    expect(submitted.status).toBe(201);
    const submission = view(submitted).submissions[0]!;
    expect(view(submitted).scenario.status).toBe('SUBMITTED');

    const path = scenarios(`/${id}/submissions/${submission.id}`);
    const first = await raw(app, 'GET', path, tokens['viewer']!);
    const second = await raw(app, 'GET', path, tokens['lead']!);
    expect(first.statusCode).toBe(200);
    expect(first.rawPayload.equals(second.rawPayload)).toBe(true);
    const digest = createHash('sha256').update(first.rawPayload).digest('hex');
    expect(digest).toBe(submission.digest);
    expect(first.headers['etag']).toBe(`"sha256-${digest}"`);
    const frozen = JSON.parse(first.payload) as { run: ValuationRun; submittedBy: string };
    expect(frozen.run.result.bridge.holdbacks.amount).toBe('750000.00');
    expect(frozen.submittedBy).toBe(users['lead']!.userId);

    // Frozen: no edits, no re-runs, no second submission.
    expect((await as('lead', 'POST', `/${id}/runs`, { expectedVersion: 3 })).status).toBe(409);
    expect(
      (await as('lead', 'PUT', `/${id}/assumptions`, { expectedVersion: 3, values: values() }))
        .status,
    ).toBe(409);

    // The submitter cannot approve; analysts cannot decide; a reviewer can.
    const decide = (who: string, decision: string) =>
      as(who, 'POST', `/${id}/submissions/${submission.id}/decisions`, {
        expectedVersion: 3,
        decision,
        rationale: 'Bridge ties to accepted findings',
      });
    expect((await decide('lead', 'APPROVED')).status).toBe(403);
    expect((await decide('analyst', 'APPROVED')).status).toBe(403);
    const approved = await decide('reviewer', 'APPROVED');
    expect(approved.status).toBe(201);
    expect(view(approved).scenario.status).toBe('APPROVED');
    expect(view(approved).decisions).toEqual([
      expect.objectContaining({ decision: 'APPROVED', decidedBy: users['reviewer']!.userId }),
    ]);

    // Dependencies moving later flag the scenario but never rewrite the frozen bytes.
    await repriceFinding(findingId, '900000');
    expect(view(await as('lead', 'GET', `/${id}`)).stale).toBe(true);
    const after = await raw(app, 'GET', path, tokens['lead']!);
    expect(after.rawPayload.equals(first.rawPayload)).toBe(true);
    expect((await as('lead', 'POST', `/${id}/runs`, { expectedVersion: 4 })).status).toBe(409);

    const audits = async (targetId: string) =>
      (
        (await db.owner.query(
          `SELECT action FROM audit_events WHERE target_id = $1 AND outcome = 'SUCCEEDED' AND action <> 'valuation.submission.exported' ORDER BY chain_seq`,
          [targetId],
        )) as { rows: { action: string }[] }
      ).rows.map((row) => row.action);
    expect(await audits(id)).toEqual([
      'valuation.scenario.created',
      'valuation.run',
      'valuation.approved',
    ]);
    expect(await audits(submission.id)).toEqual(['valuation.submitted']);
    const exported = (await db.owner.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE target_id = $1 AND action = 'valuation.submission.exported'`,
      [submission.id],
    )) as { rows: { n: number }[] };
    expect(exported.rows[0]?.n).toBe(3);
  });

  it('only accepted priced risks can move a valuation; inputs stay decimal', async () => {
    const draft = await call(app, 'POST', `/v1/deals/${a.dealId}/findings`, tokens['analyst']!, {
      domain: 'SECURITY',
      title: 'Unreviewed draft',
      description: 'Not yet reviewed.',
      severity: 'LOW',
      confidence: 'LOW',
      evidence: [],
      pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: '1', high: '2', basis: 'x' },
    });
    const draftId = draft.body['id'] as string;
    expect(
      (
        await as('analyst', 'POST', '', {
          name: 'Draft link',
          values: values({ findingLinks: [{ findingId: draftId, point: 'LOW' }] }),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await as('analyst', 'POST', '', {
          name: 'Float',
          values: values({ assumptions: { method: 'ARR_MULTIPLE', arr: 10000000, multiple: '6' } }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await as('analyst', 'POST', '', {
          name: 'Stock without EPS inputs',
          values: values({ stockConsiderationShare: '0.4' }),
        })
      ).status,
    ).toBe(422);
    const eur = await acceptedFinding({
      type: 'REMEDIATION_COST',
      currency: 'EUR',
      low: '10',
      high: '20',
      basis: 'EUR quote',
    });
    expect(
      (
        await as('analyst', 'POST', '', {
          name: 'Currency mismatch',
          values: values({ findingLinks: [{ findingId: eur, point: 'LOW' }] }),
        })
      ).status,
    ).toBe(422);
  });

  it('take-private deals require LBO inputs and report sponsor returns', async () => {
    const take = (payload: Body) =>
      call(app, 'POST', scenarios('', () => c.dealId), tokens['charlie']!, payload);
    expect((await take({ name: 'No LBO', values: values() })).status).toBe(422);
    const created = view(
      await take({
        name: 'Sponsor case',
        values: values({
          lbo: {
            entryEbitda: '5000000',
            leverageMultiple: '5',
            exitEbitda: '10000000',
            exitMultiple: '12',
            holdYears: 5,
            debtRepaid: '5000000',
          },
        }),
      }),
    );
    expect(created.scenario.transactionType).toBe('TAKE_PRIVATE');
    const ran = await call(
      app,
      'POST',
      scenarios(`/${created.scenario.id}/runs`, () => c.dealId),
      tokens['charlie']!,
      { expectedVersion: 1 },
    );
    expect(view(ran).latestRun!.result.lbo).toMatchObject({ moic: '2.5000', irr: '0.2011' });
  });

  it('keeps valuation away from target contributors, other tenants and read-only roles', async () => {
    const anyId = (
      (await db.owner.query(`SELECT id FROM valuation_scenarios WHERE deal_id = $1 LIMIT 1`, [
        a.dealId,
      ])) as { rows: { id: string }[] }
    ).rows[0]!.id;
    expect((await as('target_contributor', 'GET', '')).status).toBe(403);
    expect((await as('target_contributor', 'GET', `/${anyId}`)).status).toBe(403);
    expect((await as('viewer', 'GET', '')).status).toBe(200);
    expect((await as('viewer', 'POST', '', { name: 'x', values: values() })).status).toBe(403);
    expect((await as('reviewer', 'POST', `/${anyId}/runs`, { expectedVersion: 1 })).status).toBe(
      403,
    );
    expect((await as('other', 'GET', '')).status).toBe(404);
    expect((await as('other', 'GET', `/${anyId}`)).status).toBe(404);
    expect(
      (await call(app, 'GET', scenarios(`/${anyId}`, () => b.dealId), tokens['other']!)).status,
    ).toBe(404);
    const denied = (await db.owner.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id = $1 AND action = 'valuation.list' AND outcome = 'DENIED'`,
      [users['target_contributor']!.userId],
    )) as { rows: { n: number }[] };
    expect(denied.rows[0]?.n).toBe(1);
  });
});
