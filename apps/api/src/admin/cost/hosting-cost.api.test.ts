import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { withTenant, type CostGranularity, type HostingCostLine } from '@pactlab/db';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { JwtIdentityVerifier } from '../../auth/identity';
import type { CostSource } from './cost-explorer';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const MODEL = 'us.anthropic.claude-sonnet-5-5';
type Body = Record<string, unknown>;

/** A fake Cost Explorer: what the payer account would bill, by month or day. No network. */
class FakeCostSource implements CostSource {
  readonly calls: { granularity: CostGranularity; from: string; to: string }[] = [];
  failing = false;
  async fetch(granularity: CostGranularity, from: string, to: string): Promise<HostingCostLine[]> {
    this.calls.push({ granularity, from, to });
    if (this.failing) throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    const line = (periodStart: string, environment: string, service: string, amount: string): HostingCostLine => ({ periodStart, environment, service, amount, currency: 'USD', estimated: false });
    return granularity === 'MONTHLY'
      ? [line('2026-10-01', 'prod', 'Amazon Relational Database Service', '40.00'), line('2026-10-01', 'prod', 'Amazon Bedrock', '5.00'), line('2026-10-01', 'stage', 'Amazon Relational Database Service', '12.50'), line('2026-11-01', 'prod', 'Amazon Relational Database Service', '20.00')]
      : [line('2026-11-10', 'prod', 'Amazon Relational Database Service', '1.25'), line('2026-11-10', 'prod', 'Amazon Bedrock', '0.75'), line('2026-11-11', 'dev', 'AWS Fargate', '0.40')];
  }
}

/** Hosting cost in the operator console: real spend from (fake) Cost Explorer, rates, metered estimates. */
describe('hosting cost', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let key: CryptoKey;
  let operator: string;
  let operatorTenant: SyntheticTenant;
  let customer: SyntheticTenant;
  let clock = new Date('2026-11-15T12:00:00Z');
  const source = new FakeCostSource();

  async function call(method: 'GET' | 'POST' | 'DELETE', url: string, bearer: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const tokenFor = (tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('30m').sign(key);
  const settle = async () => {
    for (let i = 0; i < 100 && ((await db.owner.query(`SELECT count(*)::int AS n FROM hosting_cost_syncs`)).rows[0] as { n: number }).n === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    operatorTenant = await createSyntheticTenant(db.owner, 'Operators');
    customer = await createSyntheticTenant(db.owner, 'Customer (synthetic)');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operatorTenant.userId]);
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      environment: 'production',
      hostingCost: { source, now: () => clock },
    });
    operator = await tokenFor(operatorTenant);

    // A run recorded in the customer's tenant context names its person by default.
    await withTenant(db.prisma, customer.context, (tx) =>
      tx.aiRun.create({
        data: { id: newId(), organizationId: customer.organizationId, dealId: customer.dealId, taskType: 'document.question', promptId: 'p', promptVersion: '1', promptHash: 'h', modelAlias: 'balanced', resolvedModelId: MODEL, inputHashes: [], outputHash: null, status: 'SUCCEEDED', repairAttempted: false, injectionSignals: 0, inputTokens: 1_000_000, outputTokens: 200_000, latencyMs: 10, createdAt: new Date('2026-11-12T10:00:00Z') },
      }),
    );
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('records who asked for an AI run, from the tenant context', async () => {
    expect((await db.owner.query(`SELECT requested_by FROM ai_runs WHERE organization_id = $1`, [customer.organizationId])).rows).toEqual([{ requested_by: customer.userId }]);
  });

  it('is for operators only', async () => {
    const outsider = await tokenFor(customer);
    expect((await call('GET', '/v1/admin/cost?from=2026-11-01&to=2026-12-01', outsider)).status).toBe(403);
    expect((await call('POST', '/v1/admin/cost/refresh', outsider)).status).toBe(403);
    expect((await call('POST', '/v1/admin/cost/rates', outsider, { kind: 'S3_STORAGE_GB_MONTH', key: 'standard', unitPrice: '0.023', effectiveFrom: '2026-01-01' })).status).toBe(403);
  });

  it('a first view starts a refresh from Cost Explorer; spend comes back by month, environment and product', async () => {
    const first = await call('GET', '/v1/admin/cost?from=2026-11-01&to=2026-12-01', operator);
    expect(first.status).toBe(200);
    expect(first.body['source']).toMatchObject({ configured: true, environment: 'prod', refreshing: true });
    await settle();
    // 13 months monthly, the last 92 days daily.
    expect(source.calls).toEqual([
      { granularity: 'MONTHLY', from: '2025-11-01', to: '2026-12-01' },
      { granularity: 'DAILY', from: '2026-08-15', to: '2026-11-16' },
    ]);
    const view = (await call('GET', '/v1/admin/cost?from=2026-11-01&to=2026-12-01', operator)).body as { period: Body; actual: { total: string; byEnvironment: Body[]; byService: Body[] }; source: Body };
    expect(view.period['granularity']).toBe('DAILY');
    expect(view.actual.total).toBe('2.40');
    expect(view.actual.byEnvironment).toEqual([{ key: 'prod', label: 'prod', amount: '2.00' }, { key: 'dev', label: 'dev', amount: '0.40' }]);
    expect(view.source['lastStatus']).toBe('SUCCEEDED');
    // A longer period reads whole months.
    const months = (await call('GET', '/v1/admin/cost?from=2026-01-01&to=2026-12-01&environment=prod', operator)).body as { period: Body; actual: { total: string; byMonth: Body[] } };
    expect(months.period['granularity']).toBe('MONTHLY');
    expect(months.actual.total).toBe('65.00');
    expect(months.actual.byMonth.map((month) => month['month'])).toEqual(['2026-10', '2026-11']);
  });

  it('a refresh replaces what is stored, at most once an hour', async () => {
    expect((await call('POST', '/v1/admin/cost/refresh', operator)).body).toMatchObject({ code: 'CONFLICT' });
    clock = new Date(clock.getTime() + 3_600_000);
    expect((await call('POST', '/v1/admin/cost/refresh', operator)).status).toBe(200);
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM hosting_cost_lines`)).rows[0]).toEqual({ n: 7 });
    // A failure is recorded with its error class, and the stored spend stays.
    source.failing = true;
    clock = new Date(clock.getTime() + 3_600_000);
    expect((await call('POST', '/v1/admin/cost/refresh', operator)).body).toMatchObject({ state: { lastStatus: 'FAILED', lastError: 'AccessDeniedException' } });
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM hosting_cost_lines`)).rows[0]).toEqual({ n: 7 });
    source.failing = false;
  });

  it('metered estimates need rates, and say which are missing; then price by organization, pact and person', async () => {
    const before = (await call('GET', '/v1/admin/cost?from=2026-11-01&to=2026-12-01', operator)).body as { metered: { ai: string; missingRates: string[]; byPerson: Body[] } };
    expect(before.metered.ai).toBe('0.00');
    expect(before.metered.missingRates).toEqual([`BEDROCK_INPUT_PER_MTOK ${MODEL}`, `BEDROCK_OUTPUT_PER_MTOK ${MODEL}`]);
    for (const [kind, unitPrice] of [['BEDROCK_INPUT_PER_MTOK', '3'], ['BEDROCK_OUTPUT_PER_MTOK', '15']] as const) {
      expect((await call('POST', '/v1/admin/cost/rates', operator, { kind, key: MODEL, unitPrice, effectiveFrom: '2026-01-01', sourceNote: 'AWS Bedrock pricing page (synthetic)' })).status).toBe(201);
    }
    const view = (await call('GET', '/v1/admin/cost?from=2026-11-01&to=2026-12-01', operator)).body as {
      metered: { ai: string; total: string; missingRates: string[] };
      shared: Body;
      bedrockCheck: Body;
    };
    // 1M input × $3 + 0.2M output × $15 = $6.
    expect(view.metered).toMatchObject({ ai: '6.00', total: '6.00', missingRates: [] });
    // Each breakdown is priced, summed and paged in the database (T-126).
    const breakdown = async (dimension: string, extra = '') => (await call('GET', `/v1/admin/cost/metered/${dimension}?from=2026-11-01&to=2026-12-01${extra}`, operator)).body as { items: Body[]; total: number; nextCursor: string | null };
    expect((await breakdown('organization')).items[0]).toMatchObject({ key: customer.organizationId, total: '6.00', runs: 1, detail: 'Company SSO' });
    expect((await breakdown('pact')).items[0]).toMatchObject({ key: customer.dealId, total: '6.00' });
    expect((await breakdown('person')).items[0]).toMatchObject({ key: customer.userId, total: '6.00' });
    expect((await breakdown('model')).items[0]).toMatchObject({ key: MODEL, ai: '6.00', inputTokens: 1_000_000, outputTokens: 200_000 });
    expect((await call('GET', '/v1/admin/cost/metered/everything?from=2026-11-01&to=2026-12-01', operator)).status).toBe(400);
    // Live's billed spend in the period, less what is metered, is the shared line; Bedrock is checked against the meter.
    expect(view.shared).toEqual({ environment: 'prod', actual: '2.00', metered: '6.00', unallocated: '-4.00' });
    expect(view.bedrockCheck).toEqual({ actual: '0.75', metered: '6.00' });
    const audit = (await db.owner.query(`SELECT DISTINCT action FROM audit_events WHERE action LIKE 'operator.cost%' ORDER BY action`)).rows.map((row) => (row as { action: string }).action);
    expect(audit).toEqual(['operator.cost_rate_set', 'operator.cost_refresh_failed', 'operator.cost_refreshed']);
  });

  it('rates can be corrected on the same date and deleted', async () => {
    const rates = (await call('GET', '/v1/admin/cost/rates', operator)).body['items'] as { id: string; kind: string; unitPrice: string }[];
    const input = rates.find((rate) => rate.kind === 'BEDROCK_INPUT_PER_MTOK')!;
    await call('POST', '/v1/admin/cost/rates', operator, { kind: 'BEDROCK_INPUT_PER_MTOK', key: MODEL, unitPrice: '2.5', effectiveFrom: '2026-01-01' });
    expect(((await call('GET', '/v1/admin/cost/rates', operator)).body['items'] as { id: string; unitPrice: string }[]).find((rate) => rate.id === input.id)?.unitPrice).toBe('2.5');
    expect((await call('DELETE', `/v1/admin/cost/rates/${input.id}`, operator)).status).toBe(200);
    expect((await call('DELETE', `/v1/admin/cost/rates/${input.id}`, operator)).status).toBe(404);
    expect((await call('POST', '/v1/admin/cost/rates', operator, { kind: 'BEDROCK_INPUT_PER_MTOK', key: MODEL, unitPrice: '-1', effectiveFrom: '2026-01-01' })).status).toBe(400);
  });

  it('breakdowns page most expensive first, each row once, priced at the rate in force on the day (T-126)', async () => {
    // Two more organizations' runs: a smaller one, and one before a price change on 10 November.
    const second = await createSyntheticTenant(db.owner, 'Second (synthetic)');
    const third = await createSyntheticTenant(db.owner, 'Third (synthetic)');
    const run = (tenant: SyntheticTenant, input: number, at: string) =>
      withTenant(db.prisma, tenant.context, (tx) =>
        tx.aiRun.create({
          data: { id: newId(), organizationId: tenant.organizationId, dealId: tenant.dealId, taskType: 'document.question', promptId: 'p', promptVersion: '1', promptHash: 'h', modelAlias: 'balanced', resolvedModelId: MODEL, inputHashes: [], outputHash: null, status: 'SUCCEEDED', repairAttempted: false, injectionSignals: 0, inputTokens: input, outputTokens: 0, latencyMs: 1, createdAt: new Date(at) },
        }),
      );
    await run(second, 1_000_000, '2026-11-05T10:00:00Z');
    await run(third, 1_000_000, '2026-11-11T10:00:00Z');
    await call('POST', '/v1/admin/cost/rates', operator, { kind: 'BEDROCK_INPUT_PER_MTOK', key: MODEL, unitPrice: '2.5', effectiveFrom: '2026-01-01' });
    await call('POST', '/v1/admin/cost/rates', operator, { kind: 'BEDROCK_INPUT_PER_MTOK', key: MODEL, unitPrice: '1', effectiveFrom: '2026-11-10' });
    const totals: string[] = [];
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = (await call('GET', `/v1/admin/cost/metered/organization?from=2026-11-01&to=2026-12-01&limit=1${cursor ? `&cursor=${cursor}` : ''}`, operator)).body as { items: { key: string; total: string }[]; nextCursor: string | null; total: number };
      expect(page.total).toBe(3);
      seen.push(...page.items.map((item) => item.key));
      totals.push(...page.items.map((item) => item.total));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    // The first organization's run was on the 12th (after the change): 1M x $1 + 0.2M x $15 = $4.
    expect(seen).toEqual([customer.organizationId, second.organizationId, third.organizationId]);
    expect(totals).toEqual(['4.00', '2.50', '1.00']);
  });
});
