import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * Test-only software authenticator (T-108): a P-256 key that answers WebAuthn
 * ceremonies the way a phone or laptop would, with `none` attestation, user
 * presence and verification flags, and a signature counter. Built from the
 * WebAuthn spec's byte layouts so the real verifier (@simplewebauthn/server) checks it.
 */

type Cbor = number | string | Uint8Array | Cbor[] | Map<number | string, Cbor> | Record<string, never>;

/** The few CBOR major types WebAuthn needs: unsigned/negative ints, bytes, text, arrays, maps. */
function cbor(value: Cbor): Buffer {
  const head = (major: number, length: number) => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
    if (length < 0x10000) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
    const out = Buffer.alloc(5);
    out[0] = (major << 5) | 26;
    out.writeUInt32BE(length, 1);
    return out;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item as Cbor)])]);
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest();
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  /** Synced passkeys report 0 forever; hardware keys count up. */
  counter: number;

  constructor(options: { counter?: number } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.publicJwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.counter = options.counter ?? 0;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  private authenticatorData(rpId: string, flags: number, attested?: Buffer): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), count, ...(attested ? [attested] : [])]);
  }

  /** The answer to `navigator.credentials.create`, as @simplewebauthn/browser returns it. */
  register(options: { challenge: string; rp: { id: string } }, origin: string, overrides: { uv?: boolean } = {}) {
    const coseKey = cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(this.publicJwk.x, 'base64url')], [-3, Buffer.from(this.publicJwk.y, 'base64url')]]));
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLength, this.credentialId, coseKey]);
    const authData = this.authenticatorData(options.rp.id, FLAG_UP | (overrides.uv === false ? 0 : FLAG_UV) | FLAG_AT, attested);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
    const attestationObject = cbor(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
      response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ['internal'] },
    };
  }

  /** The answer to `navigator.credentials.get`. Counts up first if this authenticator counts. */
  authenticate(options: { challenge: string; rpId?: string }, origin: string, rpId = options.rpId ?? 'localhost') {
    if (this.counter > 0) this.counter += 1;
    const authData = this.authenticatorData(rpId, FLAG_UP | FLAG_UV);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
      response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature) },
    };
  }
}
