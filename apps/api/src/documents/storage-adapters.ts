import type { DocumentObjectStore } from './documents.repository';
import type { MalwareScanner, MalwareVerdict } from './upload-policy';

// The tenant-prefixed file store lives in @pactlab/db so the worker can read uploads too.
export { FileSystemObjectStore } from '@pactlab/db';

/** Fails closed where no object store is configured: uploads cannot persist bytes. */
export class UnavailableObjectStore implements DocumentObjectStore {
  async put(): Promise<void> {
    throw new Error('Document object store is not configured');
  }

  async get(): Promise<Uint8Array> {
    throw new Error('Document object store is not configured');
  }

  async delete(): Promise<void> {
    throw new Error('Document object store is not configured');
  }
}

/** Fails closed where no managed scanner is configured: every upload is rejected. */
export class UnavailableMalwareScanner implements MalwareScanner {
  readonly name = 'unavailable';

  async scan(): Promise<MalwareVerdict> {
    return 'UNAVAILABLE';
  }
}
