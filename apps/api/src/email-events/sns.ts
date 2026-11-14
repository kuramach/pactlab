import { createPublicKey, createVerify, X509Certificate, type KeyObject } from 'node:crypto';
import { z } from 'zod';

/**
 * Amazon SNS HTTPS notifications (T-109): parsed, then verified against the signing certificate
 * before anything in them is trusted. The certificate must come from an SNS host over https, and
 * the topic must be the one this environment subscribed.
 */
const snsMessageSchema = z.object({
  Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
  MessageId: z.string().min(1).max(200),
  TopicArn: z.string().min(1).max(512),
  Message: z.string().max(256 * 1024),
  Timestamp: z.string().min(1).max(64),
  SignatureVersion: z.enum(['1', '2']),
  Signature: z.string().min(1).max(4096),
  SigningCertURL: z.string().min(1).max(1024),
  Subject: z.string().max(512).optional(),
  SubscribeURL: z.string().max(2048).optional(),
  Token: z.string().max(2048).optional(),
});
export type SnsMessage = z.infer<typeof snsMessageSchema>;

/** Where SNS keeps its signing certificates and confirmation links. */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function isSnsUrl(value: string, path?: RegExp): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname) && !url.username && !url.password && !url.port && (!path || path.test(url.pathname));
  } catch {
    return false;
  }
}

/** The string SNS signs: named fields in a fixed order, each as "Name\nvalue\n". */
export function stringToSign(message: SnsMessage): string {
  const fields: (keyof SnsMessage)[] =
    message.Type === 'Notification'
      ? ['Message', 'MessageId', ...(message.Subject !== undefined ? (['Subject'] as const) : []), 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.map((field) => `${field}\n${message[field] ?? ''}\n`).join('');
}

export type CertificateFetcher = (url: URL) => Promise<string>;

export class SnsVerificationError extends Error {
  constructor(readonly reason: 'MALFORMED' | 'WRONG_TOPIC' | 'CERT_URL' | 'CERT' | 'SIGNATURE') {
    super(`SNS message refused (${reason})`);
    this.name = 'SnsVerificationError';
  }
}

/** Verifies SNS messages for one topic; certificates are cached by URL. */
export class SnsVerifier {
  private readonly certificates = new Map<string, Promise<KeyObject>>();

  constructor(
    private readonly topicArn: string,
    private readonly fetchCertificate: CertificateFetcher,
  ) {}

  private key(url: string): Promise<KeyObject> {
    let key = this.certificates.get(url);
    if (!key) {
      key = this.fetchCertificate(new URL(url)).then((pem) => (pem.includes('BEGIN CERTIFICATE') ? new X509Certificate(pem).publicKey : createPublicKey(pem)));
      // A failed fetch is not cached: the next message tries again.
      key.catch(() => this.certificates.delete(url));
      this.certificates.set(url, key);
    }
    return key;
  }

  async verify(body: unknown): Promise<SnsMessage> {
    const parsed = snsMessageSchema.safeParse(typeof body === 'string' ? safeJson(body) : body);
    if (!parsed.success) throw new SnsVerificationError('MALFORMED');
    const message = parsed.data;
    if (message.TopicArn !== this.topicArn) throw new SnsVerificationError('WRONG_TOPIC');
    if (!isSnsUrl(message.SigningCertURL, /^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/)) throw new SnsVerificationError('CERT_URL');
    if (message.Type !== 'Notification' && (!message.SubscribeURL || !message.Token)) throw new SnsVerificationError('MALFORMED');
    let key: KeyObject;
    try {
      key = await this.key(message.SigningCertURL);
    } catch {
      throw new SnsVerificationError('CERT');
    }
    const verifier = createVerify(message.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
    verifier.update(stringToSign(message), 'utf8');
    if (!verifier.verify(key, message.Signature, 'base64')) throw new SnsVerificationError('SIGNATURE');
    return message;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
