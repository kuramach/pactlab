import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FileSystemObjectStore,
  UnavailableMalwareScanner,
  UnavailableObjectStore,
} from './storage-adapters';

describe('document storage adapters', () => {
  let root: string;
  let store: FileSystemObjectStore;
  const org = newId();
  const deal = newId();

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pactlab-docs-'));
    store = new FileSystemObjectStore(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes owner-only files under the tenant prefix and deletes them', async () => {
    const key = `${org}/${deal}/documents/${newId()}/original`;
    await store.put(key, new TextEncoder().encode('synthetic'));
    const path = join(root, key);
    expect(await readFile(path, 'utf8')).toBe('synthetic');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await store.delete(key);
    await expect(stat(path)).rejects.toThrow();
  });

  it('never overwrites an existing original', async () => {
    const key = `${org}/${deal}/documents/${newId()}/original`;
    await store.put(key, new Uint8Array([1]));
    await expect(store.put(key, new Uint8Array([2]))).rejects.toThrow();
  });

  it('rejects keys without a tenant prefix or that escape the root', async () => {
    for (const key of [
      'documents/x',
      `${org}/documents`,
      `${org}/${deal}/../../etc/passwd`,
      `${org}/${deal}//x`,
      `../${org}/${deal}/x`,
      `not-a-uuid/${deal}/x`,
    ]) {
      await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow();
    }
  });

  it('fails closed when nothing is configured', async () => {
    await expect(new UnavailableObjectStore().put()).rejects.toThrow(/not configured/);
    await expect(new UnavailableMalwareScanner().scan()).resolves.toBe('UNAVAILABLE');
  });
});
