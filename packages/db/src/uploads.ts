import type { EvidenceVisibility, ImportTarget } from '@pactlab/domain';
import type { Prisma, TransactionClient } from './client';
import { connections, type ConnectionRecord } from './evidence';

export const BILLING_UPLOAD_PROVIDER = 'billing_upload';
/** Connections created by industry-pack CSV imports (ADR 0010), one per target. */
export const PACK_UPLOAD_PROVIDER = 'pack_upload';

export interface SourceUploadRecord {
  id: string;
  organizationId: string;
  dealId: string;
  connectionId: string | null;
  target: ImportTarget;
  system: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  rowCount: number;
  header: Prisma.JsonValue;
  mapping: Prisma.JsonValue | null;
  mappingVersion: string | null;
  objectKey: string | null;
  status: 'UPLOADED' | 'IMPORTED' | 'REJECTED' | 'PURGED';
  syncRunId: string | null;
  visibility: EvidenceVisibility;
  uploadedBy: string;
  createdAt: Date;
  importedAt: Date | null;
}

const uploadSelect = {
  id: true,
  organizationId: true,
  dealId: true,
  connectionId: true,
  target: true,
  system: true,
  fileName: true,
  sha256: true,
  sizeBytes: true,
  rowCount: true,
  header: true,
  mapping: true,
  mappingVersion: true,
  objectKey: true,
  status: true,
  syncRunId: true,
  visibility: true,
  uploadedBy: true,
  createdAt: true,
  importedAt: true,
} as const;

/** Uploaded billing exports. RLS hides buyer-only uploads from target contributors. */
export const sourceUploads = {
  async create(
    tx: TransactionClient,
    input: {
      id: string;
      organizationId: string;
      dealId: string;
      target: ImportTarget;
      system: string;
      fileName: string;
      sha256: string;
      sizeBytes: number;
      rowCount: number;
      header: string[];
      objectKey: string;
      visibility: EvidenceVisibility;
      uploadedBy: string;
    },
  ): Promise<SourceUploadRecord> {
    return tx.sourceUpload.create({ data: input, select: uploadSelect });
  },

  async get(tx: TransactionClient, dealId: string, uploadId: string): Promise<SourceUploadRecord | null> {
    return tx.sourceUpload.findFirst({ where: { id: uploadId, dealId }, select: uploadSelect });
  },

  async list(tx: TransactionClient, dealId: string): Promise<SourceUploadRecord[]> {
    return tx.sourceUpload.findMany({ where: { dealId }, select: uploadSelect, orderBy: { createdAt: 'desc' }, take: 50 });
  },

  async markImported(
    tx: TransactionClient,
    uploadId: string,
    input: { connectionId: string; syncRunId: string; mapping: Prisma.InputJsonValue; mappingVersion: string },
  ): Promise<void> {
    await tx.sourceUpload.update({
      where: { id: uploadId },
      data: { ...input, status: 'IMPORTED', importedAt: new Date() },
    });
  },

  /**
   * The upload connection for one billing system on a deal, created on first
   * import. Buyer-only and shared uploads use separate connections so their
   * evidence keeps the right visibility.
   */
  async connectionFor(
    tx: TransactionClient,
    input: {
      organizationId: string;
      dealId: string;
      system: string;
      systemLabel: string;
      /** Billing when absent; a pack target gets its own `pack_upload` connection. */
      target?: ImportTarget;
      visibility: EvidenceVisibility;
      createdBy: string;
    },
  ): Promise<ConnectionRecord> {
    const billing = !input.target || input.target === 'BILLING_INVOICE_LINE';
    const provider = billing ? BILLING_UPLOAD_PROVIDER : PACK_UPLOAD_PROVIDER;
    const existing = await tx.connection.findFirst({
      where: {
        dealId: input.dealId,
        provider,
        evidenceVisibility: input.visibility,
        config: billing ? { path: ['system'], equals: input.system } : { path: ['target'], equals: input.target ?? '' },
      },
    });
    if (existing) return existing;
    return connections.create(tx, {
      organizationId: input.organizationId,
      dealId: input.dealId,
      provider,
      displayName: `${input.systemLabel} ${billing ? 'billing export' : 'upload'}${input.visibility === 'SHARED' ? ' (shared)' : ''}`,
      mode: 'LIVE',
      credentialRef: null,
      config: billing ? { system: input.system } : { system: input.system, target: input.target ?? null },
      evidenceVisibility: input.visibility,
      createdBy: input.createdBy,
    });
  },
};
