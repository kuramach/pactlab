import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QOE_ADJUSTMENT_CATEGORIES, QOE_RECURRENCE, QOE_VERIFICATION_STATUSES, QOE_WORKING_CAPITAL_COMPONENTS, type TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const MIGRATION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations/20261220000000_quality_of_earnings/migration.sql'), 'utf8');
/** The quoted values of the CHECK branch that starts with `marker`. */
const listed = (marker: string) => [...(new RegExp(`${marker}[^(]*\\(([^)]*)\\)`).exec(MIGRATION)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);

/** Registry pattern (T-135): the database accepts exactly the categories the domain registry maps. */
describe('qoe_entries: the database CHECK lists match the domain registry', () => {
  it('adjustment categories, working-capital components, statuses and recurrence', () => {
    expect(listed(`ELSE "category" IN`).sort()).toEqual([...QOE_ADJUSTMENT_CATEGORIES].sort());
    expect(listed(`WHEN 'WORKING_CAPITAL' THEN "category" IN`).sort()).toEqual([...QOE_WORKING_CAPITAL_COMPONENTS].sort());
    expect(listed(`"verification_status" IN`).sort()).toEqual([...QOE_VERIFICATION_STATUSES].sort());
    expect(listed(`"recurrence" IN`).sort()).toEqual([...QOE_RECURRENCE].sort());
  });
});

describe('qoe_entries: persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);
  let counter = 0;
  const id = () => `018f0000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;
  const citation = { documentId: id(), pageNumber: 1, quote: 'Owner salary: 400,000' };
  const entry = (context: TenantContext, overrides: Record<string, unknown> = {}, tenant = a) =>
    inTenant(context, (tx) =>
      tx.qoeEntry.create({
        data: {
          id: id(),
          organizationId: tenant.organizationId,
          dealId: tenant.dealId,
          entryKey: id(),
          version: 1,
          kind: 'ADJUSTMENT',
          period: 'FY2025',
          category: 'OWNER_COMPENSATION',
          label: 'Owner salary to market',
          amount: '150000',
          currency: 'USD',
          citation,
          reason: 'Recorded',
          createdBy: context.userId,
          ...overrides,
        },
      }),
    );

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('stores cited entries for the buyer side', async () => {
    await entry(a.context);
    await entry(a.context, { kind: 'ADD_BACK', category: 'NON_RECURRING', verificationStatus: 'UNVERIFIED', recurrence: 'ONE_OFF', rationale: 'Seller: one-off legal fees' });
    await entry(a.context, { kind: 'WORKING_CAPITAL', period: null, periodEnd: new Date('2026-09-30'), category: 'RECEIVABLES' });
    expect(await inTenant(a.context, (tx) => tx.qoeEntry.count({ where: { dealId: a.dealId } }))).toBe(3);
  });

  it('refuses shapes the register forbids', async () => {
    // An unmapped category, an unverified add-back carrying a verification, an inclusion without a reason.
    await expect(entry(a.context, { category: 'SELLER_FAVOURITE' })).rejects.toThrow();
    await expect(entry(a.context, { kind: 'ADD_BACK', verificationStatus: 'UNVERIFIED', recurrence: 'ONE_OFF', verificationCitation: citation })).rejects.toThrow();
    await expect(entry(a.context, { kind: 'ADD_BACK', verificationStatus: 'UNVERIFIED', recurrence: 'ONE_OFF', inclusion: 'INCLUDE' })).rejects.toThrow();
    await expect(entry(a.context, { kind: 'ADD_BACK', verificationStatus: 'PARTIALLY_VERIFIED', recurrence: 'ONE_OFF', verificationCitation: citation })).rejects.toThrow();
  });

  it('keeps them from target contributors and other tenants, and never updates or deletes', async () => {
    for (const context of [contributor, b.context]) {
      expect(await inTenant(context, (tx) => tx.qoeEntry.findMany({ where: { dealId: a.dealId } }))).toEqual([]);
      await expect(entry(context)).rejects.toThrow();
    }
    await expect(entry(a.context, { createdBy: contributor.userId })).rejects.toThrow();
    for (const sql of [`UPDATE qoe_entries SET label = 'x'`, 'DELETE FROM qoe_entries']) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });
});
