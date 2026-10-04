import { z } from 'zod';
import type { ConnectionScope, ProviderAdapter } from '../contract';

export const VDR_PROVIDER = 'vdr';

/** Non-secret connection settings. Identical in FIXTURE and LIVE mode. */
export const vdrConnectionConfigSchema = z.strictObject({
  /** Provider-side data-room identifier (Datasite project or equivalent). */
  room: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
});
export type VdrConnectionConfig = z.infer<typeof vdrConnectionConfigSchema>;

/**
 * Provider-neutral capabilities a read-only room grant needs: list the index
 * and read document metadata. The live adapter maps these to the provider's
 * own permission names once verified against its documented API.
 */
export const VDR_REQUIRED_PERMISSIONS = ['index:read', 'document-metadata:read'] as const;

/**
 * Normalized data-room index entry. Metadata only — the adapter never returns
 * document bytes. Documents enter Pactlab through the secure upload pipeline,
 * which owns scanning, page extraction and retention.
 */
export interface VdrDocumentRef {
  readonly externalId: string;
  /** Room index number as shown to bidders, when the provider assigns one. */
  readonly indexNumber: string | null;
  /** Folder path inside the room, `/`-separated, without the document name. */
  readonly folderPath: string;
  readonly name: string;
  readonly version: number;
  readonly mediaType: string;
  readonly sizeBytes: number | null;
  /** Provider-reported content hash; null when the provider omits it. */
  readonly sha256: string | null;
  readonly modifiedAt: string | null;
}

/** Fields downstream lineage depends on; a document missing one cannot be cited. */
export const VDR_REQUIRED_FIELDS = ['externalId', 'folderPath', 'name', 'version'] as const;
/** Fields that make provenance stronger but whose absence is reported, not fatal. */
export const VDR_OPTIONAL_FIELDS = ['sha256', 'modifiedAt', 'sizeBytes'] as const;

export interface VdrDocumentPage {
  readonly documents: readonly VdrDocumentRef[];
  readonly nextCursor: string | null;
}

/** Normalized read-only data-room interface. */
export interface VdrAdapter extends ProviderAdapter<VdrDocumentRef> {
  readonly version: string;
  listDocuments(
    scope: ConnectionScope,
    options: { cursor: string | null; limit: number },
  ): Promise<VdrDocumentPage>;
}

export class VdrAdapterError extends Error {
  constructor(
    readonly code: 'NOT_ENABLED' | 'UNKNOWN_ROOM' | 'PERMISSION_DENIED' | 'INVALID_CURSOR',
    message: string,
  ) {
    super(message);
    this.name = 'VdrAdapterError';
  }
}
