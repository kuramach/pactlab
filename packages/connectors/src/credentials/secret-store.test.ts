import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalEncryptedSecretStore, UnavailableSecretStore } from './secret-store';

describe('local encrypted secret store', () => {
  let dir: string;
  const key = randomBytes(32).toString('base64');

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pactlab-secrets-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a secret without writing it or its reference in plain text', async () => {
    const store = new LocalEncryptedSecretStore(dir, key);
    await store.put('secretref:org-1/deal-1/github', 'github_pat_SECRETVALUE');
    await expect(store.get('secretref:org-1/deal-1/github')).resolves.toBe('github_pat_SECRETVALUE');
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('org-1');
    const raw = await readFile(join(dir, files[0]!));
    expect(raw.toString('latin1')).not.toContain('SECRETVALUE');
  });

  it('refuses the wrong key, unknown references and non-references', async () => {
    await new LocalEncryptedSecretStore(dir, key).put('secretref:a/b', 'value');
    await expect(new LocalEncryptedSecretStore(dir, randomBytes(32).toString('base64')).get('secretref:a/b')).rejects.toThrow(
      /could not be decrypted/,
    );
    await expect(new LocalEncryptedSecretStore(dir, key).get('secretref:a/none')).rejects.toThrow(/not found/);
    await expect(new LocalEncryptedSecretStore(dir, key).put('../etc/passwd', 'x')).rejects.toThrow(/Not a secret reference/);
    expect(() => new LocalEncryptedSecretStore(dir, 'short')).toThrow(/32 bytes/);
  });

  it('fails closed when no store is configured', async () => {
    await expect(new UnavailableSecretStore().get()).rejects.toThrow(/not available/);
  });
});
