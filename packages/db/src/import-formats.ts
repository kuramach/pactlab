import { newId, type EvidenceVisibility, type ImportTarget } from '@pactlab/domain';
import type { Prisma, TransactionClient } from './client';

/** A saved import format (ADR 0042), as the import reads it. */
export interface ImportFormatRecord {
  id: string;
  target: ImportTarget;
  signature: string;
  headerRow: number | null;
  mapping: unknown;
  sourceUploadId: string;
  sourceFileName: string;
  confirmedAt: Date;
}

/** At most this many saved formats per pact and target are tried on a new file. */
export const MAX_FORMATS_TRIED = 20;

export const importFormats = {
  /** A pact's saved formats for one import target, most recently confirmed first (RLS decides which the caller sees). */
  async forTarget(tx: TransactionClient, dealId: string, target: ImportTarget): Promise<ImportFormatRecord[]> {
    return tx.importFormat.findMany({
      where: { dealId, target },
      orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }],
      take: MAX_FORMATS_TRIED,
      select: { id: true, target: true, signature: true, headerRow: true, mapping: true, sourceUploadId: true, sourceFileName: true, confirmedAt: true },
    });
  },

  /** Save (or replace) the format a person confirmed on an import. */
  async save(
    tx: TransactionClient,
    input: { organizationId: string; dealId: string; target: ImportTarget; signature: string; headerRow: number | null; mapping: Prisma.InputJsonValue; sourceUploadId: string; sourceFileName: string; visibility: EvidenceVisibility; confirmedBy: string; at: Date },
  ): Promise<string> {
    const existing = await tx.importFormat.findFirst({ where: { dealId: input.dealId, target: input.target, signature: input.signature, visibility: input.visibility }, select: { id: true } });
    const data = {
      headerRow: input.headerRow,
      mapping: input.mapping,
      sourceUploadId: input.sourceUploadId,
      sourceFileName: input.sourceFileName,
      visibility: input.visibility,
      confirmedBy: input.confirmedBy,
      confirmedAt: input.at,
    };
    if (existing) {
      await tx.importFormat.update({ where: { id: existing.id }, data });
      return existing.id;
    }
    const id = newId();
    await tx.importFormat.create({ data: { id, organizationId: input.organizationId, dealId: input.dealId, target: input.target, signature: input.signature, ...data } });
    return id;
  },

  async recordUse(tx: TransactionClient, id: string, at: Date): Promise<void> {
    await tx.importFormat.update({ where: { id }, data: { uses: { increment: 1 }, lastUsedAt: at } });
  },
};
