import { createHash, randomBytes } from 'node:crypto';

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
