import type { TransactionClient } from '@pactlab/db';

/** Largest evidence read for one pack rule or metrics run. */
export const MAX_PACK_EVIDENCE = 200_000;

export class TooMuchPackEvidenceError extends Error {
  constructor() {
    super('Too much evidence for one pack run');
    this.name = 'TooMuchPackEvidenceError';
  }
}

export interface PackEvidenceRow {
  id: string;
  evidenceType: string;
  sourceRecordId: string;
  canonical: Record<string, string | null>;
}

/**
 * The pack evidence that rules and calculators read (T-060): the newest
 * version of each source record of the given types (earlier versions stay in
 * lineage), in a bounded read. One loader for findings and metrics, so both
 * see the same records.
 */
export async function loadPackEvidence(tx: TransactionClient, dealId: string, evidenceTypes: readonly string[]): Promise<PackEvidenceRow[]> {
  if (evidenceTypes.length === 0) return [];
  const rows = await tx.evidenceItem.findMany({
    where: { dealId, evidenceType: { in: [...evidenceTypes] } },
    select: { id: true, connectionId: true, evidenceType: true, sourceRecordId: true, canonical: true },
    orderBy: { id: 'asc' },
    take: MAX_PACK_EVIDENCE + 1,
  });
  if (rows.length > MAX_PACK_EVIDENCE) throw new TooMuchPackEvidenceError();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(`${row.connectionId}|${row.evidenceType}|${row.sourceRecordId}`, row);
  return [...latest.values()].map((row) => ({
    id: row.id,
    evidenceType: row.evidenceType,
    sourceRecordId: row.sourceRecordId,
    canonical: (row.canonical ?? {}) as Record<string, string | null>,
  }));
}
