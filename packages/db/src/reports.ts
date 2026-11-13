import type { TransactionClient } from './client';

/**
 * Report versions (T-110). Called inside `withTenant`, so RLS decides what a caller sees: their
 * organization's executive reports, and reports on pacts they are on. A version is immutable once
 * READY (database trigger); the only later change is PURGED when its pact is deleted.
 */
/** IC: an investment-committee pack for one pact (T-118). */
export type ReportScope = 'EXECUTIVE' | 'PACT' | 'IC';
export type ReportStatus = 'GENERATING' | 'READY' | 'FAILED' | 'PURGED';

export interface ReportVersionRecord {
  id: string;
  organizationId: string;
  scope: ReportScope;
  dealId: string | null;
  version: number;
  status: ReportStatus;
  generatedBy: string;
  generatedByName: string | null;
  generatedAt: Date;
  dataAsOf: Date;
  captured: Record<string, unknown>;
  objectKey: string | null;
  sha256: string | null;
  byteSize: number | null;
}

type Row = { id: string; organizationId: string; scope: string; dealId: string | null; version: number; status: string; generatedBy: string; generatedAt: Date; dataAsOf: Date; captured: unknown; objectKey: string | null; sha256: string | null; byteSize: number | null };

const toRecord = (row: Row, names: Map<string, string>): ReportVersionRecord => ({
  ...row,
  scope: row.scope as ReportScope,
  status: row.status as ReportStatus,
  captured: (row.captured ?? {}) as Record<string, unknown>,
  generatedByName: names.get(row.generatedBy) ?? null,
});

async function withNames(tx: TransactionClient, rows: Row[]): Promise<ReportVersionRecord[]> {
  const ids = [...new Set(rows.map((row) => row.generatedBy))];
  const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return rows.map((row) => toRecord(row, names));
}

const OWN_SIDE_SERIES = '00000000-0000-0000-0000-000000000000';

export const reportVersions = {
  /** The next version for this scope, as GENERATING. Serialized per scope so numbers never collide. */
  async begin(tx: TransactionClient, input: { organizationId: string; scope: ReportScope; dealId: string | null; generatedBy: string; dataAsOf: Date }): Promise<ReportVersionRecord> {
    // The series the database will give this version (T-118): the pact's own side shares one; anyone else has their own.
    const [own] = input.dealId ? await tx.$queryRaw<{ own: boolean }[]>`SELECT app_is_buyer_side(${input.dealId}::uuid) AS own` : [{ own: false }];
    const series = own?.own ? OWN_SIDE_SERIES : input.generatedBy;
    const lockKey = `report:${input.organizationId}:${input.scope}:${input.dealId ?? '-'}:${series}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const last = await tx.reportVersion.findFirst({
      where: { organizationId: input.organizationId, scope: input.scope, dealId: input.dealId, series },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const row = await tx.reportVersion.create({
      data: { organizationId: input.organizationId, scope: input.scope, dealId: input.dealId, version: (last?.version ?? 0) + 1, generatedBy: input.generatedBy, dataAsOf: input.dataAsOf },
    });
    const [record] = await withNames(tx, [row]);
    if (!record) throw new Error('report version not created');
    return record;
  },

  async ready(tx: TransactionClient, id: string, input: { objectKey: string; sha256: string; byteSize: number; captured: Record<string, unknown> }): Promise<void> {
    await tx.reportVersion.update({ where: { id }, data: { status: 'READY', objectKey: input.objectKey, sha256: input.sha256, byteSize: input.byteSize, captured: input.captured as never } });
  },

  async failed(tx: TransactionClient, id: string): Promise<void> {
    await tx.reportVersion.update({ where: { id }, data: { status: 'FAILED' } });
  },

  async history(tx: TransactionClient, filter: { scope?: ReportScope; dealId?: string }): Promise<ReportVersionRecord[]> {
    const rows = await tx.reportVersion.findMany({
      where: { ...(filter.scope ? { scope: filter.scope } : {}), ...(filter.dealId ? { dealId: filter.dealId } : {}) },
      orderBy: [{ generatedAt: 'desc' }],
      take: 200,
    });
    return withNames(tx, rows);
  },

  async get(tx: TransactionClient, id: string): Promise<ReportVersionRecord | null> {
    const row = await tx.reportVersion.findUnique({ where: { id } });
    if (!row) return null;
    const [record] = await withNames(tx, [row]);
    return record ?? null;
  },

  /** A deleted pact's report files: their keys, then mark them PURGED. */
  async purgeForDeal(tx: TransactionClient, dealId: string): Promise<string[]> {
    const rows = await tx.reportVersion.findMany({ where: { dealId, status: 'READY' }, select: { id: true, objectKey: true } });
    if (rows.length > 0) await tx.reportVersion.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { status: 'PURGED', objectKey: null } });
    return rows.flatMap((row) => (row.objectKey ? [row.objectKey] : []));
  },
};
