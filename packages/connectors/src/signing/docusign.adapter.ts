import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FetchLike } from '../http/cassette';
import { SigningProviderError, type EnvelopeRequest, type EnvelopeStatus, type SigningEvent, type SigningProvider } from './types';

/**
 * DocuSign (T-107, ADR 0022), from DocuSign's developer documentation:
 * - OAuth 2.0 Authorization Code Grant: `/oauth/auth`, `/oauth/token` (Basic
 *   integration key:secret; `authorization_code` and `refresh_token` grants),
 *   `/oauth/userinfo` for the account id and base URI. Scope `signature`.
 * - eSignature REST v2.1: `POST {baseUri}/restapi/v2.1/accounts/{accountId}/envelopes`
 *   with base64 documents and signers with anchored sign-here tabs; status by
 *   `GET …/envelopes/{envelopeId}`.
 * - Connect (JSON SIM): `X-DocuSign-Signature-N` headers carry base64
 *   HMAC-SHA256 of the raw body; events such as `envelope-completed`.
 * The customer connects their own account; Pactlab holds only its app's
 * integration key (a registration, not a sending account).
 */

/** Pactlab's app registration, per environment. */
export interface DocuSignAppConfig {
  readonly integrationKey: string;
  readonly clientSecret: string;
  /** `account-d.docusign.com` (developer) or `account.docusign.com` (production). */
  readonly authHost: string;
}

export interface DocuSignTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export interface DocuSignAccount {
  readonly accountId: string;
  readonly accountName: string;
  readonly baseUri: string;
}

const AUTH_HOSTS = new Set(['account-d.docusign.com', 'account.docusign.com']);

export class DocuSignOAuth {
  constructor(
    private readonly config: DocuSignAppConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (!AUTH_HOSTS.has(config.authHost)) throw new Error('DocuSign auth host must be account-d.docusign.com or account.docusign.com');
  }

  /** Where the organization admin signs in to DocuSign and grants Pactlab access. */
  authorizeUrl(redirectUri: string, state: string): string {
    const query = new URLSearchParams({ response_type: 'code', scope: 'signature', client_id: this.config.integrationKey, redirect_uri: redirectUri, state });
    return `https://${this.config.authHost}/oauth/auth?${query.toString()}`;
  }

  private async token(body: Record<string, string>): Promise<DocuSignTokens> {
    const basic = Buffer.from(`${this.config.integrationKey}:${this.config.clientSecret}`).toString('base64');
    const response = await this.fetchImpl(`https://${this.config.authHost}/oauth/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    if (response.status === 400 || response.status === 401) throw new SigningProviderError('DocuSign refused the authorization', 'AUTH');
    if (!response.ok) throw new SigningProviderError('DocuSign is unavailable', 'UNAVAILABLE');
    const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!json.access_token || !json.refresh_token || !json.expires_in) throw new SigningProviderError('DocuSign returned no token', 'AUTH');
    return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: this.now() + json.expires_in * 1000 };
  }

  exchangeCode(code: string): Promise<DocuSignTokens> {
    return this.token({ grant_type: 'authorization_code', code });
  }

  refresh(refreshToken: string): Promise<DocuSignTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** The user's default account: the one envelopes are sent from. */
  async defaultAccount(accessToken: string): Promise<DocuSignAccount> {
    const response = await this.fetchImpl(`https://${this.config.authHost}/oauth/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new SigningProviderError('DocuSign user info failed', response.status === 401 ? 'AUTH' : 'UNAVAILABLE');
    const json = (await response.json()) as { accounts?: { account_id: string; account_name: string; base_uri: string; is_default: boolean }[] };
    const account = json.accounts?.find((entry) => entry.is_default) ?? json.accounts?.[0];
    if (!account || !/^https:\/\/[a-z0-9.-]+\.docusign\.net$/.test(account.base_uri)) throw new SigningProviderError('No usable DocuSign account', 'AUTH');
    return { accountId: account.account_id, accountName: account.account_name, baseUri: account.base_uri };
  }
}

const STATUS: Readonly<Record<string, EnvelopeStatus>> = { sent: 'SENT', delivered: 'SENT', completed: 'COMPLETED', declined: 'DECLINED', voided: 'VOIDED' };

/** Sends from one organization's connected account, with a valid access token. */
export class DocuSignSigningProvider implements SigningProvider {
  readonly name = 'DOCUSIGN' as const;

  constructor(
    private readonly account: DocuSignAccount,
    private readonly accessToken: () => Promise<string>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private url(path: string): string {
    return `${this.account.baseUri}/restapi/v2.1/accounts/${encodeURIComponent(this.account.accountId)}${path}`;
  }

  async createEnvelope(request: EnvelopeRequest): Promise<{ envelopeId: string }> {
    const body = {
      emailSubject: request.emailSubject.slice(0, 100),
      status: 'sent',
      documents: request.documents.map((document, index) => ({
        documentId: String(index + 1),
        name: document.name,
        fileExtension: document.fileExtension,
        documentBase64: Buffer.from(document.bytes).toString('base64'),
      })),
      recipients: {
        signers: request.signers.map((signer, index) => ({
          email: signer.email,
          name: signer.name,
          recipientId: String(index + 1),
          routingOrder: String(index + 1),
          tabs: { signHereTabs: [{ anchorString: signer.anchor, anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '0' }] },
        })),
      },
    };
    const response = await this.fetchImpl(this.url('/envelopes'), {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) throw new SigningProviderError('DocuSign authorization expired', 'AUTH');
    if (response.status >= 400 && response.status < 500) throw new SigningProviderError('DocuSign rejected the envelope', 'REJECTED');
    if (!response.ok) throw new SigningProviderError('DocuSign is unavailable', 'UNAVAILABLE');
    const json = (await response.json()) as { envelopeId?: string };
    if (!json.envelopeId) throw new SigningProviderError('DocuSign returned no envelope', 'UNAVAILABLE');
    return { envelopeId: json.envelopeId };
  }

  async status(envelopeId: string): Promise<EnvelopeStatus> {
    const response = await this.fetchImpl(this.url(`/envelopes/${encodeURIComponent(envelopeId)}`), { headers: { authorization: `Bearer ${await this.accessToken()}` } });
    if (!response.ok) throw new SigningProviderError('DocuSign envelope status failed', response.status === 401 ? 'AUTH' : 'UNAVAILABLE');
    const json = (await response.json()) as { status?: string };
    return STATUS[json.status ?? ''] ?? 'SENT';
  }
}

/** True when any `X-DocuSign-Signature-N` header is the base64 HMAC-SHA256 of the raw body under `secret`. */
export function verifyDocuSignConnect(secret: string, rawBody: Uint8Array, headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return Object.entries(headers)
    .filter(([name]) => /^x-docusign-signature-\d+$/i.test(name))
    .flatMap(([, value]) => (Array.isArray(value) ? value : value ? [value] : []))
    .some((value) => {
      const given = Buffer.from(value, 'base64');
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

const EVENTS: Readonly<Record<string, EnvelopeStatus>> = { 'envelope-completed': 'COMPLETED', 'envelope-declined': 'DECLINED', 'envelope-voided': 'VOIDED' };

/** A Connect (JSON SIM) message reduced to an envelope outcome; null for events Pactlab does not record. */
export function parseDocuSignConnect(rawBody: Uint8Array): SigningEvent | null {
  let json: { event?: unknown; data?: { envelopeId?: unknown } };
  try {
    json = JSON.parse(Buffer.from(rawBody).toString('utf8')) as typeof json;
  } catch {
    return null;
  }
  const status = typeof json.event === 'string' ? EVENTS[json.event] : undefined;
  const envelopeId = json.data?.envelopeId;
  return status && typeof envelopeId === 'string' && /^[0-9a-f-]{36}$/i.test(envelopeId) ? { envelopeId, status } : null;
}
