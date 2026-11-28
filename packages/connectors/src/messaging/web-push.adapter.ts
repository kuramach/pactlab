import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto';
import { ChannelSendError } from './types';

/**
 * Web push (T-146), with no third-party service: the Push API's own protocol, checked against the
 * standards on 2026-11-27.
 * - RFC 8030: POST to the subscription's endpoint with a TTL header (required) and an Urgency header;
 *   201 (or 202) is accepted; 404 means the subscription expired, and 410 is treated the same way.
 * - RFC 8292 (VAPID): `Authorization: vapid t=<JWT>, k=<public key>`; the JWT is ES256 on P-256, its
 *   `aud` the endpoint's origin, `exp` at most 24 hours ahead, `sub` a mailto: or https: contact.
 * - RFC 8291: the payload is one aes128gcm record (RFC 8188) encrypted to the browser's P-256 key and
 *   auth secret, with a 0x02 padding delimiter and the 86-octet header salt | rs | idlen | keyid.
 * Endpoints are capability URLs: never logged; and only known push services are ever called (SSRF).
 */

export interface WebPushSubscription {
  readonly endpoint: string;
  /** base64url: the browser's P-256 public key, uncompressed (65 bytes). */
  readonly p256dh: string;
  /** base64url: the browser's 16-byte auth secret. */
  readonly auth: string;
}

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

export interface WebPushSender {
  readonly name: 'WEB_PUSH' | 'FIXTURE';
  /** The VAPID public key the browser subscribes with (`applicationServerKey`), base64url. */
  readonly publicKey: string;
  send(subscription: WebPushSubscription, payload: string, options?: { urgency?: PushUrgency; ttlSeconds?: number }): Promise<void>;
}

/**
 * The push services browsers use (Chrome and Android: FCM; Firefox: Mozilla autopush; Safari: Apple;
 * Edge: Windows Push Notification Services). An endpoint elsewhere is refused at subscribe and at send.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isKnownPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' && endpoint.length <= 2048 && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

const b64u = (buffer: Buffer) => buffer.toString('base64url');
const fromB64u = (value: string) => Buffer.from(value.replace(/=+$/, ''), 'base64url');

/** A VAPID key pair, base64url (the format `scripts/vapid-key.sh` writes). */
export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function vapidSigningKey(keys: VapidKeys): KeyObject {
  const point = fromB64u(keys.publicKey);
  const secret = fromB64u(keys.privateKey);
  if (point.length !== 65 || point[0] !== 0x04 || secret.length !== 32) throw new Error('VAPID keys must be a P-256 public key (65 bytes) and private key (32 bytes), base64url');
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33)), d: b64u(secret) }, format: 'jwk' });
}

/** The VAPID JWT for one push service origin (RFC 8292 §2). */
export function vapidJwt(key: KeyObject, audience: string, subject: string, now: Date): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  // 12 hours: well inside the 24-hour ceiling, so clock skew never pushes it over.
  const claims = b64u(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject })));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(signature)}`;
}

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** RFC 8291 §3.4 and RFC 8188 §2: one aes128gcm record. `salt` and `serverKeys` are for tests only. */
export function encryptPushPayload(subscription: Pick<WebPushSubscription, 'p256dh' | 'auth'>, plaintext: Buffer, test?: { salt: Buffer; serverPrivateKey: Buffer }): Buffer {
  // A single record of 4096 octets holds at most 3993 octets of plaintext (RFC 8291 §4).
  if (plaintext.length > 3993) throw new ChannelSendError('PushPayloadTooLarge');
  const uaPublic = fromB64u(subscription.p256dh);
  const authSecret = fromB64u(subscription.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new ChannelSendError('PushKeysInvalid', true);
  const ecdh = createECDH('prime256v1');
  if (test) ecdh.setPrivateKey(test.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  let ecdhSecret: Buffer;
  try {
    ecdhSecret = ecdh.computeSecret(uaPublic);
  } catch {
    throw new ChannelSendError('PushKeysInvalid', true);
  }
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const salt = test?.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export interface VapidWebPushOptions extends VapidKeys {
  /** RFC 8292 `sub`: `mailto:` or `https:`. */
  readonly subject: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

export class VapidWebPush implements WebPushSender {
  readonly name = 'WEB_PUSH' as const;
  readonly publicKey: string;
  private readonly key: KeyObject;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: VapidWebPushOptions) {
    if (!/^(mailto:|https:\/\/)/.test(options.subject)) throw new Error('VAPID_SUBJECT must be a mailto: or https: contact');
    this.key = vapidSigningKey(options);
    this.publicKey = options.publicKey.replace(/=+$/, '');
    this.fetcher = options.fetch ?? fetch;
  }

  async send(subscription: WebPushSubscription, payload: string, options: { urgency?: PushUrgency; ttlSeconds?: number } = {}): Promise<void> {
    if (!isKnownPushEndpoint(subscription.endpoint)) throw new ChannelSendError('PushServiceUnknown', true);
    const body = encryptPushPayload(subscription, Buffer.from(payload, 'utf8'));
    const jwt = vapidJwt(this.key, new URL(subscription.endpoint).origin, this.options.subject, this.options.now?.() ?? new Date());
    let response: Response;
    try {
      response = await this.fetcher(subscription.endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        headers: {
          authorization: `vapid t=${jwt}, k=${this.publicKey}`,
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(options.ttlSeconds ?? 24 * 3600),
          urgency: options.urgency ?? 'high',
        },
        body,
      });
    } catch (error) {
      throw new ChannelSendError(error instanceof Error && error.name === 'TimeoutError' ? 'PushTimeout' : 'PushUnreachable');
    }
    if (response.status === 201 || response.status === 202 || response.status === 200) return;
    if (response.status === 404 || response.status === 410) throw new ChannelSendError('PushGone', true);
    if (response.status === 413) throw new ChannelSendError('PushPayloadTooLarge');
    if (response.status === 429) throw new ChannelSendError('PushRateLimited');
    if (response.status === 401 || response.status === 403) throw new ChannelSendError('PushVapidRefused');
    throw new ChannelSendError(`PushFailed${response.status}`);
  }
}

/** Records what would be pushed, decrypted, so tests read what a device would show. */
export class FixtureWebPush implements WebPushSender {
  readonly name = 'FIXTURE' as const;
  readonly publicKey: string;
  readonly outbox: { endpoint: string; payload: string; urgency: PushUrgency; ttlSeconds: number }[] = [];
  private readonly gone = new Set<string>();

  constructor(publicKey = generateVapidKeys().publicKey) {
    this.publicKey = publicKey;
  }

  /** The push service will answer 410 for this endpoint from now on. */
  expire(endpoint: string): void {
    this.gone.add(endpoint);
  }

  async send(subscription: WebPushSubscription, payload: string, options: { urgency?: PushUrgency; ttlSeconds?: number } = {}): Promise<void> {
    if (!isKnownPushEndpoint(subscription.endpoint)) throw new ChannelSendError('PushServiceUnknown', true);
    if (this.gone.has(subscription.endpoint)) throw new ChannelSendError('PushGone', true);
    encryptPushPayload(subscription, Buffer.from(payload, 'utf8'));
    this.outbox.push({ endpoint: subscription.endpoint, payload, urgency: options.urgency ?? 'high', ttlSeconds: options.ttlSeconds ?? 24 * 3600 });
  }
}
