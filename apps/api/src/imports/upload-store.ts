import type { ImportProgress, TenantObjectStore, UploadImportJob } from '@pactlab/db';

/** Tenant-prefixed storage for uploaded exports (the local file store or the managed bucket). */
export type UploadObjectStore = TenantObjectStore;

/** Hands a large import to the worker (`upload.import`). Absent: every import runs inline. */
export interface ImportQueue {
  /** `rows` seeds the progress total, so the screen can show 0 of N while queued. */
  enqueue(job: UploadImportJob, rows: number): Promise<void>;
  /** The worker's last reported progress for a run (counts only), or null when unknown. */
  progress(run: { organizationId: string; dealId: string; syncRunId: string }): Promise<ImportProgress | null>;
}

export const UPLOAD_OBJECT_STORE = Symbol('UPLOAD_OBJECT_STORE');
export const UPLOAD_MALWARE_SCANNER = Symbol('UPLOAD_MALWARE_SCANNER');
export const IMPORT_QUEUE = Symbol('IMPORT_QUEUE');

/** Fails closed where no store is configured: nothing is accepted. */
export class UnavailableUploadStore implements UploadObjectStore {
  async put(): Promise<void> {
    throw new Error('Upload store is not configured');
  }

  async get(): Promise<Uint8Array> {
    throw new Error('Upload store is not configured');
  }

  async delete(): Promise<void> {
    throw new Error('Upload store is not configured');
  }
}
