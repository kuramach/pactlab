import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** A reference into the secret store. Never the secret itself. */
const SECRET_REF = /^secretref:[A-Za-z0-9/_+=.@-]{1,240}$/;

export function isSecretRef(value: string): boolean {
  return SECRET_REF.test(value);
}

export class SecretUnavailableError extends Error {
  constructor(message = 'Secret store is not available') {
    super(message);
    this.name = 'SecretUnavailableError';
  }
}

/**
 * Where provider credentials live. Values never leave the store except to
 * the adapter that uses them; they are never logged, returned or audited.
 */
export interface SecretStore {
  put(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string>;
}

/** Fails closed where no store is configured (deployed environments until Secrets Manager). */
export class UnavailableSecretStore implements SecretStore {
  async put(): Promise<void> {
    throw new SecretUnavailableError();
  }

  async get(): Promise<string> {
    throw new SecretUnavailableError();
  }
}

/**
 * Local-development store: one AES-256-GCM file per reference, owner-only
 * permissions, key from configuration. File names are hashes of the
 * reference, so nothing about the secret or its tenant shows on disk.
 */
export class LocalEncryptedSecretStore implements SecretStore {
  private readonly root: string;
  private readonly key: Buffer;

  constructor(root: string, keyBase64: string) {
    this.root = resolve(root);
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('LOCAL_SECRETS_KEY must be 32 bytes, base64-encoded');
  }

  private pathFor(ref: string): string {
    if (!isSecretRef(ref)) throw new SecretUnavailableError('Not a secret reference');
    return join(this.root, `${createHash('sha256').update(ref).digest('hex')}.secret`);
  }

  async put(ref: string, value: string): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(ref));
    const sealed = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.pathFor(ref), Buffer.concat([iv, cipher.getAuthTag(), sealed]), { mode: 0o600 });
  }

  async get(ref: string): Promise<string> {
    let blob: Buffer;
    try {
      blob = await readFile(this.pathFor(ref));
    } catch {
      throw new SecretUnavailableError('Secret not found');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, blob.subarray(0, 12));
      decipher.setAAD(Buffer.from(ref));
      decipher.setAuthTag(blob.subarray(12, 28));
      return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretUnavailableError('Secret could not be decrypted');
    }
  }
}

/** In-memory store for tests. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async put(ref: string, value: string): Promise<void> {
    if (!isSecretRef(ref)) throw new SecretUnavailableError('Not a secret reference');
    this.values.set(ref, value);
  }

  async get(ref: string): Promise<string> {
    const value = this.values.get(ref);
    if (value === undefined) throw new SecretUnavailableError('Secret not found');
    return value;
  }
}
