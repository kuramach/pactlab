import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { isUuid } from '@pactlab/domain';
import type { DocumentObjectStore } from './documents.repository';
import type { MalwareScanner, MalwareVerdict } from './upload-policy';

function assertTenantKey(key: string): string[] {
  const segments = key.split('/');
  const [organizationId = '', dealId = ''] = segments;
  if (
    segments.length < 3 ||
    !isUuid(organizationId) ||
    !isUuid(dealId) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Object keys must be tenant-prefixed relative paths');
  }
  return segments;
}

/**
 * Local-development object store: originals under `<root>/<org>/<deal>/...`,
 * owner-only file permissions. Deployed environments use the managed bucket
 * (tenant prefix enforced by bucket policy and KMS encryption context).
 */
export class FileSystemObjectStore implements DocumentObjectStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const path = resolve(this.root, ...assertTenantKey(key));
    if (!path.startsWith(this.root + sep)) throw new Error('Object key escapes the store root');
    return path;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/** Fails closed where no object store is configured: uploads cannot persist bytes. */
export class UnavailableObjectStore implements DocumentObjectStore {
  async put(): Promise<void> {
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
