import { canonicalJson, sha256Hex } from './canonical';

/** Canonical bytes of a submitted scenario and their SHA-256 digest. */
export interface FrozenDocument {
  readonly canonical: string;
  readonly digest: string;
}

/**
 * Freeze a submission into canonical JSON. Storage keeps the exact string;
 * every re-read returns those bytes, never a re-serialization.
 */
export function freeze(document: unknown): FrozenDocument {
  const canonical = canonicalJson(document);
  return { canonical, digest: sha256Hex(canonical) };
}

/** True when the stored bytes still match their recorded digest. */
export function verifyFrozen(frozen: FrozenDocument): boolean {
  return sha256Hex(frozen.canonical) === frozen.digest;
}
