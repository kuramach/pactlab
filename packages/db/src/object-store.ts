import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { isUuid } from '@pactlab/domain';

/**
 * Tenant-prefixed storage for uploaded originals (`<org>/<deal>/...`): the
 * local file store in development, the managed bucket when deployed. Shared
 * by the API (uploads, documents) and the worker (background imports).
 */
export interface TenantObjectStore {
  put(key: string, bytes: Uint8Array, meta?: { contentType: string; sha256: string }): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** A missing object is not an error. */
  delete(key: string): Promise<void>;
}

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
export class FileSystemObjectStore implements TenantObjectStore {
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

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }
}

/** Fails closed where no store is configured. */
export class UnavailableTenantObjectStore implements TenantObjectStore {
  async put(): Promise<void> {
    throw new Error('Object store is not configured');
  }

  async get(): Promise<Uint8Array> {
    throw new Error('Object store is not configured');
  }

  async delete(): Promise<void> {
    throw new Error('Object store is not configured');
  }
}
