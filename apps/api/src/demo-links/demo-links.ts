import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Shared-demo links (T-113): `https://app…/demo/<token>`. The token is 32 random bytes
 * (base64url), shown to the operator once; only its SHA-256 is stored. A plain hash is
 * enough here: the token carries 256 bits, so it cannot be guessed from its hash.
 */
export function newDemoToken(): string {
  return randomBytes(32).toString('base64url');
}

export function demoTokenHash(token: string): string {
  return createHash('sha256').update(`pactlab-demo-link:${token}`).digest('hex');
}

export const DEMO_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The sealing key: derived from the API's token secret, never stored. */
function sealKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'pactlab-demo-link-seal', 'v1', 32));
}

/**
 * Seal a demo token so an operator can open the link again (AES-256-GCM). Sign-in never uses
 * this: it matches the hash. `v1.<iv>.<ciphertext>.<tag>`, base64url.
 */
export function sealDemoToken(secret: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(secret), iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

/** The token back, or null when the value was sealed with another secret or altered. */
export function openDemoToken(secret: string, sealed: string): string | null {
  const [version, iv, body, tag] = sealed.split('.');
  if (version !== 'v1' || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', sealKey(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const token = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    return DEMO_TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}
