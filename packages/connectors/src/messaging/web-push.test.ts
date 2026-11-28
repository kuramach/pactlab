import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ChannelSendError } from './types';
import { encryptPushPayload, FixtureWebPush, generateVapidKeys, isKnownPushEndpoint, VapidWebPush } from './web-push.adapter';

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** A browser's side: its key pair and auth secret, and RFC 8291 decryption to check what was sent. */
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const decrypt = (message: Buffer) => {
    const salt = message.subarray(0, 16);
    const rs = message.readUInt32BE(16);
    const idlen = message.readUInt8(20);
    const asPublic = message.subarray(21, 21 + idlen);
    const secret = ecdh.computeSecret(asPublic);
    const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
    const record = message.subarray(21 + idlen);
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(record.subarray(record.length - 16));
    const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
    return { rs, idlen, delimiter: plain.at(-1), text: plain.subarray(0, -1).toString('utf8') };
  };
  return { subscription, decrypt };
}

describe('web push (T-146)', () => {
  it('encrypts one aes128gcm record the browser can decrypt (RFC 8291)', () => {
    const { subscription, decrypt } = browser();
    const message = encryptPushPayload(subscription, Buffer.from('{"title":"Pactlab"}'));
    const opened = decrypt(message);
    expect(opened).toEqual({ rs: 4096, idlen: 65, delimiter: 2, text: '{"title":"Pactlab"}' });
    // Fresh salt and server key every time.
    expect(encryptPushPayload(subscription, Buffer.from('x')).subarray(0, 16).equals(encryptPushPayload(subscription, Buffer.from('x')).subarray(0, 16))).toBe(false);
    expect(() => encryptPushPayload(subscription, Buffer.alloc(3994))).toThrow(ChannelSendError);
  });

  it('posts with a VAPID header the push service can verify, TTL and Urgency (RFC 8030, 8292)', async () => {
    const keys = generateVapidKeys();
    const { subscription, decrypt } = browser();
    const calls: { url: string; init: RequestInit }[] = [];
    const now = new Date('2026-11-27T12:00:00Z');
    const push = new VapidWebPush({ ...keys, subject: 'mailto:alerts@pactlab.ai', now: () => now, fetch: async (url, init) => (calls.push({ url: String(url), init: init! }), new Response(null, { status: 201 })) });
    await push.send(subscription, 'hello');
    const [call] = calls;
    const headers = call!.init.headers as Record<string, string>;
    expect(call!.url).toBe(subscription.endpoint);
    expect(call!.init.redirect).toBe('manual');
    expect(headers).toMatchObject({ 'content-encoding': 'aes128gcm', ttl: '86400', urgency: 'high' });
    const match = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(headers['authorization']!);
    expect(match?.[2]).toBe(keys.publicKey);
    const [header, claims, signature] = match![1]!.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const body = JSON.parse(Buffer.from(claims!, 'base64url').toString()) as { aud: string; exp: number; sub: string };
    expect(body.aud).toBe('https://fcm.googleapis.com');
    expect(body.sub).toBe('mailto:alerts@pactlab.ai');
    expect(body.exp - now.getTime() / 1000).toBeLessThanOrEqual(24 * 3600);
    const point = Buffer.from(keys.publicKey, 'base64url');
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'))).toBe(true);
    expect(decrypt(Buffer.from(call!.init.body as Uint8Array)).text).toBe('hello');
  });

  it('a 404 or 410 means the subscription is gone; other refusals are named, never with the endpoint', async () => {
    const keys = generateVapidKeys();
    const { subscription } = browser();
    for (const [status, errorClass, gone] of [[404, 'PushGone', true], [410, 'PushGone', true], [429, 'PushRateLimited', false], [403, 'PushVapidRefused', false], [500, 'PushFailed500', false]] as const) {
      const push = new VapidWebPush({ ...keys, subject: 'mailto:alerts@pactlab.ai', fetch: async () => new Response(null, { status }) });
      const error = await push.send(subscription, 'x').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ChannelSendError);
      expect(error).toMatchObject({ errorClass, recipientGone: gone });
      expect(String((error as Error).message)).not.toContain('fcm');
    }
  });

  it('only ever calls a known push service: no other host, no http, no credentials (SSRF)', async () => {
    expect(isKnownPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isKnownPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isKnownPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isKnownPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com.evil.example/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'nonsense']) {
      expect(isKnownPushEndpoint(bad)).toBe(false);
    }
    let called = false;
    const push = new VapidWebPush({ ...generateVapidKeys(), subject: 'mailto:alerts@pactlab.ai', fetch: async () => ((called = true), new Response(null, { status: 201 })) });
    await expect(push.send({ ...browser().subscription, endpoint: 'https://internal.example/x' }, 'x')).rejects.toMatchObject({ errorClass: 'PushServiceUnknown' });
    expect(called).toBe(false);
  });

  it('the fixture records what a device would show, and can play an expired subscription', async () => {
    const fixture = new FixtureWebPush();
    const { subscription } = browser();
    await fixture.send(subscription, 'one');
    fixture.expire(subscription.endpoint);
    await expect(fixture.send(subscription, 'two')).rejects.toMatchObject({ errorClass: 'PushGone', recipientGone: true });
    expect(fixture.outbox.map((row) => row.payload)).toEqual(['one']);
  });
});
