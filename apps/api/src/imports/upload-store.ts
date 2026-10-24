/** Tenant-prefixed storage for uploaded billing exports (the local file store or the managed bucket). */
export interface UploadObjectStore {
  put(key: string, bytes: Uint8Array, meta: { contentType: string; sha256: string }): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Remove a stored original (a cancelled upload); a missing object is not an error. */
  delete(key: string): Promise<void>;
}

export const UPLOAD_OBJECT_STORE = Symbol('UPLOAD_OBJECT_STORE');
export const UPLOAD_MALWARE_SCANNER = Symbol('UPLOAD_MALWARE_SCANNER');

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
