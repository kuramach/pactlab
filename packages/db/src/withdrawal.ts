import { newId, type SourceWithdrawnFlag } from '@pactlab/domain';
import type { Prisma, TransactionClient } from './client';

/**
 * Withdrawn imports (T-154, ADR 0039). An item is void while it carries an
 * unrestored void; every read path that turns evidence into numbers, checks or
 * exports filters on `ACTIVE_EVIDENCE` (or `ACTIVE_EVIDENCE_SQL`), and
 * `apps/api/src/voided-evidence.test.ts` fails the build on one that does not.
 */
export const ACTIVE_EVIDENCE = { voids: { none: { restoredAt: null } } } as const satisfies Prisma.EvidenceItemWhereInput;

/** The same rule for raw SQL over `evidence_items` (aliased or not): append with AND. */
export const ACTIVE_EVIDENCE_SQL = `NOT EXISTS (SELECT 1 FROM evidence_voids v WHERE v.evidence_item_id = evidence_items.id AND v.restored_at IS NULL)`;

const VOID_BATCH = 5_000;

export interface WithdrawalOutcome {
  /** Evidence items voided now: held by no other active import. */
  voided: number;
  /** Findings that cite the voided items: flagged, never changed. */
  findingIds: string[];
  /** Valuation runs whose adjustments rest on those findings: flagged, never changed. */
  valuationRunIds: string[];
}

export const withdrawals = {
  /**
   * Withdraw an imported upload: the record stays (with who, when and why);
   * the evidence its run read is voided unless another active import still
   * reads it. Returns the artefacts that consumed it, for the audit log.
   */
  async withdraw(
    tx: TransactionClient,
    input: { organizationId: string; dealId: string; uploadId: string; syncRunId: string; actorUserId: string; reason: string; at: Date },
  ): Promise<WithdrawalOutcome | null> {
    const marked = await tx.sourceUpload.updateMany({
      where: { id: input.uploadId, dealId: input.dealId, status: 'IMPORTED' },
      data: { status: 'WITHDRAWN', withdrawnAt: input.at, withdrawnBy: input.actorUserId, withdrawalReason: input.reason.trim() },
    });
    if (marked.count !== 1) return null;
    // Items this run read that no other imported upload's run reads (and not voided by this upload already).
    const orphaned = await tx.$queryRaw<{ id: string }[]>`
      SELECT m.evidence_item_id::text AS id
        FROM sync_run_evidence m
       WHERE m.deal_id = ${input.dealId}::uuid AND m.sync_run_id = ${input.syncRunId}::uuid
         AND NOT EXISTS (
           SELECT 1 FROM sync_run_evidence o
             JOIN source_uploads u ON u.deal_id = o.deal_id AND u.sync_run_id = o.sync_run_id
            WHERE o.deal_id = m.deal_id AND o.evidence_item_id = m.evidence_item_id
              AND u.status = 'IMPORTED' AND u.id <> ${input.uploadId}::uuid)
         AND NOT EXISTS (
           SELECT 1 FROM evidence_voids v
            WHERE v.evidence_item_id = m.evidence_item_id AND v.source_upload_id = ${input.uploadId}::uuid)`;
    const ids = orphaned.map((row) => row.id);
    for (let start = 0; start < ids.length; start += VOID_BATCH) {
      await tx.evidenceVoid.createMany({
        data: ids.slice(start, start + VOID_BATCH).map((evidenceItemId) => ({
          id: newId(),
          organizationId: input.organizationId,
          dealId: input.dealId,
          evidenceItemId,
          sourceUploadId: input.uploadId,
          voidedAt: input.at,
          voidedBy: input.actorUserId,
        })),
        skipDuplicates: true,
      });
    }
    const findingIds = (
      await tx.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT l.finding_id::text AS id
          FROM finding_evidence_links l
          JOIN evidence_voids v ON v.evidence_item_id = l.evidence_item_id
         WHERE l.deal_id = ${input.dealId}::uuid AND v.source_upload_id = ${input.uploadId}::uuid
         ORDER BY 1`
    ).map((row) => row.id);
    const valuationRunIds = findingIds.length === 0 ? [] : await runsResting(tx, input.dealId, findingIds, input.at);
    return { voided: ids.length, findingIds, valuationRunIds };
  },

  /**
   * A seller withdrawing an import they uploaded (Kumar, 2026-11-25): the same steps, run by
   * `app_import_withdraw_own`, which sees the whole pact (buyer-only imports and findings included) so no
   * record another import still reads is voided and every affected finding is named. Null when the import
   * is not the caller's or not (still) imported.
   */
  async withdrawOwn(tx: TransactionClient, input: { uploadId: string; reason: string }): Promise<WithdrawalOutcome | null> {
    const [row] = await tx.$queryRaw<{ outcome: { voided: number; findingIds: string[]; valuationRunIds: string[] } | null }[]>`
      SELECT app_import_withdraw_own(${input.uploadId}::uuid, ${input.reason}) AS outcome`;
    return row?.outcome ?? null;
  },

  /**
   * A later import that read voided records again (a re-import of the same
   * rows) restores them; the void stays as history, naming the import that restored it.
   */
  async restoreHeld(tx: TransactionClient, input: { dealId: string; uploadId: string; syncRunId: string; at: Date }): Promise<number> {
    return tx.$executeRaw`
      UPDATE evidence_voids v SET restored_at = ${input.at}, restored_by_upload_id = ${input.uploadId}::uuid
       WHERE v.deal_id = ${input.dealId}::uuid AND v.restored_at IS NULL
         AND EXISTS (SELECT 1 FROM sync_run_evidence m
                      WHERE m.sync_run_id = ${input.syncRunId}::uuid AND m.evidence_item_id = v.evidence_item_id)`;
  },

  /**
   * "Source withdrawn" flags for findings: a finding cited an item before the
   * import holding it was withdrawn. A restored item keeps the flag: what the
   * finding was built on was withdrawn, whatever came later.
   */
  async findingFlags(tx: TransactionClient, dealId: string, findingIds: readonly string[]): Promise<Map<string, SourceWithdrawnFlag[]>> {
    const flags = new Map<string, SourceWithdrawnFlag[]>();
    if (findingIds.length === 0) return flags;
    const rows = await tx.$queryRaw<{ finding_id: string; upload_id: string; file_name: string; withdrawn_at: Date; reason: string }[]>`
      SELECT DISTINCT l.finding_id::text AS finding_id, u.id::text AS upload_id, u.file_name, u.withdrawn_at, u.withdrawal_reason AS reason
        FROM finding_evidence_links l
        JOIN evidence_voids v ON v.evidence_item_id = l.evidence_item_id AND v.voided_at >= l.created_at
        JOIN source_uploads u ON u.id = v.source_upload_id AND u.withdrawn_at IS NOT NULL
       WHERE l.deal_id = ${dealId}::uuid AND l.finding_id = ANY (${[...findingIds]}::uuid[])
       ORDER BY u.withdrawn_at, u.id::text`;
    for (const row of rows) {
      const list = flags.get(row.finding_id) ?? [];
      list.push({ uploadId: row.upload_id, fileName: row.file_name, withdrawnAt: row.withdrawn_at.toISOString(), reason: row.reason });
      flags.set(row.finding_id, list);
    }
    return flags;
  },

  /** Flags for a valuation run: withdrawals, after the run, of a source its adjusting findings cite. */
  async runFlags(tx: TransactionClient, dealId: string, run: { ranAt: Date; findingIds: readonly string[] }): Promise<SourceWithdrawnFlag[]> {
    const byFinding = await withdrawals.findingFlags(tx, dealId, run.findingIds);
    const seen = new Map<string, SourceWithdrawnFlag>();
    for (const list of byFinding.values())
      for (const flag of list) if (new Date(flag.withdrawnAt) >= run.ranAt) seen.set(flag.uploadId, flag);
    return [...seen.values()].sort((a, b) => a.withdrawnAt.localeCompare(b.withdrawnAt));
  },
};

/** Valuation runs, from before the withdrawal, whose adjustments rest on these findings. */
async function runsResting(tx: TransactionClient, dealId: string, findingIds: readonly string[], at: Date): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT r.id::text AS id FROM valuation_runs r
     WHERE r.deal_id = ${dealId}::uuid AND r.ran_at <= ${at}
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.inputs->'adjustments', '[]'::jsonb)) a
                    WHERE a->>'findingId' = ANY (${[...findingIds]}::text[]))
     ORDER BY r.ran_at, r.id`;
  return rows.map((row) => row.id);
}
