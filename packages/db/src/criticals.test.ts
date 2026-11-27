import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRITICAL_COMPARATORS, CRITICAL_METRIC_IDS, CRITICAL_RATINGS, CRITICAL_STATES, type TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const MIGRATION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations/20270117000000_deal_criticals/migration.sql'), 'utf8');
const listed = (marker: string) => [...(new RegExp(`${marker}[^(]*\\(([^)]*)\\)`).exec(MIGRATION)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);

/** Registry pattern (T-179): the database accepts exactly what the domain registry lists. */
describe('deal_criticals: the database CHECK lists match the domain registry', () => {
  it('metrics, comparators, states and ratings', () => {
    expect(listed(`"metric" IS NULL OR "metric" IN`).sort()).toEqual([...CRITICAL_METRIC_IDS].sort());
    expect(listed(`"comparator" IS NULL OR "comparator" IN`).sort()).toEqual([...CRITICAL_COMPARATORS].sort());
    expect(listed(`"state" IN`).sort()).toEqual([...CRITICAL_STATES].sort());
    expect(listed(`"rating" IN`).sort()).toEqual([...CRITICAL_RATINGS].sort());
  });
});

describe('deal_criticals and critical_evaluations: persistence and RLS (buyer-confidential)', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);
  let counter = 0;
  const id = () => `018f0000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;
  const critical = (context: TenantContext, overrides: Record<string, unknown> = {}, tenant = a) =>
    inTenant(context, (tx) =>
      tx.dealCritical.create({
        data: { id: id(), organizationId: tenant.organizationId, dealId: null, criticalKey: id(), version: 1, scope: 'ORG', companyType: 'MULTIFAMILY', words: 'Cap rate at least 6%', metric: 'CAP_RATE', comparator: 'AT_LEAST', threshold: '0.06', state: 'CONFIRMED', structureSource: 'AI', createdBy: context.userId, ...overrides },
      }),
    );
  const evaluation = (context: TenantContext, overrides: Record<string, unknown> = {}) =>
    inTenant(context, (tx) =>
      tx.criticalEvaluation.create({
        data: { id: id(), organizationId: a.organizationId, dealId: a.dealId, runId: id(), criticalKey: id(), criticalVersion: 1, origin: 'ORG', snapshot: {}, rating: 'BAD', receipts: {}, rationale: 'Missed', policyBreach: true, evidenceMark: 'm', engineVersion: 'criticals-1', evaluatedBy: context.userId, ...overrides },
      }),
    );

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);
  afterAll(async () => db?.stop());

  it('stores org standards, pact criticals and overrides for the buyer side', async () => {
    const standard = await critical(a.context);
    await critical(a.context, { dealId: a.dealId, scope: 'PACT', companyType: null, overridesKey: standard.criticalKey, threshold: '0.055', reason: 'Value-add plan (synthetic)' });
    await critical(a.context, { dealId: a.dealId, scope: 'PACT', companyType: null, metric: null, comparator: null, threshold: null, structureSource: null, state: 'PROPOSED', words: 'Anchor lease at least 5 years' });
    await evaluation(a.context);
    expect(await inTenant(a.context, (tx) => tx.dealCritical.count())).toBe(3);
  });

  it('refuses shapes the registry forbids', async () => {
    // A confirmed critical without its structure, an override without a reason, an unmapped metric, a breach on a pact critical.
    await expect(critical(a.context, { threshold: null })).rejects.toThrow();
    await expect(critical(a.context, { dealId: a.dealId, scope: 'PACT', companyType: null, overridesKey: id() })).rejects.toThrow();
    await expect(critical(a.context, { metric: 'VIBES' })).rejects.toThrow();
    await expect(evaluation(a.context, { origin: 'PACT' })).rejects.toThrow();
    await expect(evaluation(a.context, { rating: 'NO_EVIDENCE', policyBreach: false })).rejects.toThrow();
  });

  it('keeps every critical and rating from the seller and other tenants, and never updates or deletes', async () => {
    for (const context of [contributor, b.context]) {
      expect(await inTenant(context, (tx) => tx.dealCritical.findMany({ where: { organizationId: a.organizationId }, take: 10 }))).toEqual([]);
      expect(await inTenant(context, (tx) => tx.criticalEvaluation.findMany({ where: { dealId: a.dealId }, take: 10 }))).toEqual([]);
      await expect(evaluation(context)).rejects.toThrow();
    }
    await expect(critical(contributor, {}, a)).rejects.toThrow();
    await expect(critical(contributor, { dealId: a.dealId, scope: 'PACT', companyType: null })).rejects.toThrow();
    await expect(critical(a.context, { createdBy: contributor.userId })).rejects.toThrow();
    for (const sql of [`UPDATE deal_criticals SET words = 'x'`, 'DELETE FROM deal_criticals', `UPDATE critical_evaluations SET rating = 'GOOD'`]) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });
});
