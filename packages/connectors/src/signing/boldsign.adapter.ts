import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FetchLike } from '../http/cassette';
import {
  headerValue,
  SigningProviderError,
  type EnvelopeRequest,
  type EnvelopeState,
  type EnvelopeStatus,
  type SignedArtifacts,
  type SigningEvent,
  type SigningProvider,
  type SigningWebhook,
} from './types';

/**
 * BoldSign (T-136, ADR 0036): Pactlab signing, sent from Pactlab's own BoldSign account. Written
 * from BoldSign's developer documentation (developers.boldsign.com, read 2026-11-19):
 * - Auth: the `X-API-KEY` header (authentication/api-key).
 * - `POST /v1/document/send` (JSON; `Files` as `{ base64: "data:application/pdf;base64,…", fileName }`,
 *   `Signers[]` with `Name`, `EmailAddress`, `SignerType: "Signer"`, `SignerOrder`, `EnableSigningOrder`,
 *   `UseTextTags`, `ExpiryDays`, `DisableEmails`); answers `{ documentId }`. Sending is asynchronous:
 *   a `SendFailed` webhook can follow.
 * - Text tags: `{{sign|<signer index>|*}}` places a required signature for that signer (text-tags/*).
 * - `GET /v1/document/getEmbeddedSignLink?documentId&signerEmail&redirectUrl&signLinkValidTill`
 *   answers `{ signLink }` (embedded-signing/get-embedded-signing-link).
 * - `GET /v1/document/properties?documentId` answers `status` and `signerDetails[]` (`signerEmail`,
 *   `status`, `isViewed`), with `declineMessage` / `revokeMessage` (documents/document-details-and-status).
 * - `GET /v1/document/download?documentId` (the signed PDF) and `GET /v1/document/downloadAuditLog?documentId`
 *   (the audit trail PDF).
 * - Webhooks: `X-BoldSign-Event` names the event (`Verification` is the endpoint check, answered 200);
 *   `X-BoldSign-Signature: t=<unix seconds>, s0=<hex>[, s1=<hex>]` where each `s` is the hex
 *   HMAC-SHA256 of `<t>.<raw body>` under the webhook's signing secret; 300 seconds of clock skew
 *   (webhooks/verify-webhook-events). Payload `{ event: { id, eventType }, data: { object: "document",
 *   documentId, status, signerDetails[], revokeMessage, errorMessage } }` (webhooks/sample-event-data).
 * Status strings are matched loosely: the documentation shows them only by example.
 */
export interface BoldSignConfig {
  readonly apiKey: string;
  /** `https://api.boldsign.com` (US region) unless configured. */
  readonly baseUrl: string;
}

const looseStatus = (value: unknown) => (typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]/g, '') : '');
const reasonOf = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null);

interface SignerDetail {
  readonly signerEmail?: unknown;
  readonly status?: unknown;
  readonly isViewed?: unknown;
  readonly declineMessage?: unknown;
}

function declineReason(signers: unknown, fallback: unknown): string | null {
  const list = Array.isArray(signers) ? (signers as SignerDetail[]) : [];
  return reasonOf(list.find((signer) => looseStatus(signer.status) === 'declined')?.declineMessage) ?? reasonOf(fallback);
}

export class BoldSignSigningProvider implements SigningProvider {
  readonly name = 'BOLDSIGN' as const;
  private readonly base: string;

  constructor(
    private readonly config: BoldSignConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search) throw new Error('BOLDSIGN_API_BASE_URL must be an https origin');
    this.base = url.origin;
  }

  private async call(method: 'GET' | 'POST', path: string, query: Record<string, string>, body?: unknown): Promise<Response> {
    const url = `${this.base}${path}?${new URLSearchParams(query).toString()}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { 'X-API-KEY': this.config.apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
      });
    } catch {
      throw new SigningProviderError('BoldSign is unavailable', 'UNAVAILABLE');
    }
    if (response.status === 401 || response.status === 403) throw new SigningProviderError('BoldSign refused the API key', 'AUTH');
    if (response.status >= 400 && response.status < 500) throw new SigningProviderError('BoldSign rejected the request', 'REJECTED');
    if (!response.ok) throw new SigningProviderError('BoldSign is unavailable', 'UNAVAILABLE');
    return response;
  }

  async createEnvelope(request: EnvelopeRequest): Promise<{ envelopeId: string }> {
    if (request.documents.length === 0 || request.signers.length === 0) throw new SigningProviderError('An envelope needs a document and a signer', 'REJECTED');
    const body = {
      Title: request.emailSubject.slice(0, 256),
      Message: request.emailSubject.slice(0, 256),
      // Signing happens inside Pactlab's embedded session; BoldSign sends no emails of its own.
      DisableEmails: true,
      EnableSigningOrder: true,
      UseTextTags: true,
      ...(request.expiresInDays ? { ExpiryDays: Math.max(1, Math.min(180, Math.round(request.expiresInDays))) } : {}),
      Signers: request.signers.map((signer, index) => ({ Name: signer.name, EmailAddress: signer.email, SignerType: 'Signer', SignerOrder: index + 1 })),
      Files: request.documents.map((document) => ({ base64: `data:application/pdf;base64,${Buffer.from(document.bytes).toString('base64')}`, fileName: document.name.endsWith('.pdf') ? document.name : `${document.name}.pdf` })),
    };
    const json = (await (await this.call('POST', '/v1/document/send', {}, body)).json()) as { documentId?: unknown };
    if (typeof json.documentId !== 'string' || !json.documentId) throw new SigningProviderError('BoldSign returned no document', 'UNAVAILABLE');
    return { envelopeId: json.documentId };
  }

  async status(envelopeId: string): Promise<EnvelopeState> {
    const json = (await (await this.call('GET', '/v1/document/properties', { documentId: envelopeId })).json()) as {
      status?: unknown;
      signerDetails?: unknown;
      declineMessage?: unknown;
      revokeMessage?: unknown;
    };
    switch (looseStatus(json.status)) {
      case 'completed':
        return { status: 'COMPLETED', reason: null };
      case 'declined':
        return { status: 'DECLINED', reason: declineReason(json.signerDetails, json.declineMessage) };
      case 'expired':
        return { status: 'EXPIRED', reason: null };
      case 'revoked':
        return { status: 'VOIDED', reason: reasonOf(json.revokeMessage) };
      default: {
        const viewed = Array.isArray(json.signerDetails) && (json.signerDetails as SignerDetail[]).some((signer) => signer.isViewed === true);
        return { status: viewed ? 'DELIVERED' : 'SENT', reason: null };
      }
    }
  }

  async embeddedSigningUrl(envelopeId: string, signerEmail: string, returnUrl: string): Promise<string | null> {
    // The link is opened at once; ten minutes is ample and keeps a leaked link short-lived.
    const validTill = new Date(this.now() + 10 * 60_000).toISOString();
    const json = (await (await this.call('GET', '/v1/document/getEmbeddedSignLink', { documentId: envelopeId, signerEmail, redirectUrl: returnUrl, signLinkValidTill: validTill })).json()) as { signLink?: unknown };
    if (typeof json.signLink !== 'string' || !/^https:\/\//.test(json.signLink)) throw new SigningProviderError('BoldSign returned no signing link', 'UNAVAILABLE');
    return json.signLink;
  }

  async artifacts(envelopeId: string): Promise<SignedArtifacts> {
    const bytes = async (path: string) => new Uint8Array(await (await this.call('GET', path, { documentId: envelopeId })).arrayBuffer());
    const document = await bytes('/v1/document/download');
    const certificate = await bytes('/v1/document/downloadAuditLog');
    if (document.length === 0 || certificate.length === 0) throw new SigningProviderError('BoldSign returned an empty file', 'UNAVAILABLE');
    return { document, certificate };
  }
}

const EVENTS: Readonly<Record<string, EnvelopeStatus>> = {
  viewed: 'DELIVERED',
  completed: 'COMPLETED',
  declined: 'DECLINED',
  expired: 'EXPIRED',
  revoked: 'VOIDED',
  // Never sent (e.g. a bad text tag): settled as void, with BoldSign's reason, never left open.
  sendfailed: 'VOIDED',
};

export class BoldSignWebhook implements SigningWebhook {
  readonly provider = 'BOLDSIGN' as const;

  constructor(private readonly secret: string) {}

  isPing(headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
    return headerValue(headers, 'x-boldsign-event') === 'Verification';
  }

  verify(rawBody: Uint8Array, headers: Readonly<Record<string, string | string[] | undefined>>, nowMs: number = Date.now()): boolean {
    const header = headerValue(headers, 'x-boldsign-signature');
    if (!this.secret || !header) return false;
    const parts = header.split(',').map((part) => part.trim().split('='));
    const timestamp = parts.find(([key]) => key === 't')?.[1];
    if (!timestamp || !/^\d{1,12}$/.test(timestamp) || Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false;
    const expected = createHmac('sha256', this.secret).update(`${timestamp}.`).update(rawBody).digest();
    return parts
      .filter(([key, value]) => /^s\d+$/.test(key ?? '') && /^[0-9a-f]{64}$/i.test(value ?? ''))
      .some(([, value]) => {
        const given = Buffer.from(value as string, 'hex');
        return given.length === expected.length && timingSafeEqual(given, expected);
      });
  }

  parse(rawBody: Uint8Array): SigningEvent | null {
    let json: { event?: { id?: unknown; eventType?: unknown }; data?: { object?: unknown; documentId?: unknown; signerDetails?: unknown; revokeMessage?: unknown; errorMessage?: unknown } };
    try {
      json = JSON.parse(Buffer.from(rawBody).toString('utf8')) as typeof json;
    } catch {
      return null;
    }
    const type = looseStatus(json.event?.eventType);
    const status = EVENTS[type];
    const eventId = json.event?.id;
    const envelopeId = json.data?.documentId;
    if (!status || json.data?.object !== 'document' || typeof eventId !== 'string' || !eventId || typeof envelopeId !== 'string' || !/^[0-9A-Za-z-]{8,64}$/.test(envelopeId)) return null;
    const reason =
      status === 'DECLINED'
        ? declineReason(json.data.signerDetails, null)
        : status === 'VOIDED'
          ? type === 'sendfailed'
            ? `BoldSign could not send it${reasonOf(json.data.errorMessage) ? `: ${reasonOf(json.data.errorMessage)}` : ''}`
            : reasonOf(json.data.revokeMessage)
          : null;
    return { eventId, envelopeId, status, reason };
  }
}
