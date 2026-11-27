import { createHmac, timingSafeEqual } from 'node:crypto';
import { ChannelSendError, WHATSAPP_TEMPLATES, type WhatsAppInbound, type WhatsAppSender, type WhatsAppTemplate } from './types';

/**
 * The WhatsApp Business Platform Cloud API (developers.facebook.com, read 2026-11-27):
 * `POST https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages` with `Authorization: Bearer`,
 * template messages `{ messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
 * template: { name, language: { code }, components } }`. Webhooks: a GET handshake echoing `hub.challenge`
 * when `hub.verify_token` matches, and POSTs signed `X-Hub-Signature-256: sha256=<HMAC of the raw body with
 * the app secret>`. Inbound messages arrive in `entry[].changes[].value.messages[]`.
 * Paid per delivered template message: off unless Kumar's approval is recorded (ADR 0064, runbook).
 */
export interface WhatsAppCloudOptions {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly appSecret: string;
  readonly verifyToken: string;
  /** Graph API version, e.g. `v27.0` (the examples' version, 2026-11). */
  readonly apiVersion: string;
  /** The approved templates' language code. */
  readonly languageCode?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export class WhatsAppCloudApi implements WhatsAppSender {
  readonly name = 'WHATSAPP_CLOUD' as const;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: WhatsAppCloudOptions) {
    if (!/^v\d+\.\d+$/.test(options.apiVersion)) throw new Error('WHATSAPP_API_VERSION must look like v27.0');
    if (!/^\d{5,32}$/.test(options.phoneNumberId)) throw new Error('WHATSAPP_PHONE_NUMBER_ID is not a phone number id');
    this.fetcher = options.fetch ?? fetch;
  }

  private async send(to: string, template: WhatsAppTemplate, components: unknown[]): Promise<void> {
    const base = this.options.baseUrl ?? 'https://graph.facebook.com';
    let response: Response;
    try {
      response = await this.fetcher(`${base}/${this.options.apiVersion}/${this.options.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to.replace(/^\+/, ''),
          type: 'template',
          template: { name: WHATSAPP_TEMPLATES[template], language: { code: this.options.languageCode ?? 'en' }, components },
        }),
        redirect: 'manual',
      });
    } catch {
      throw new ChannelSendError('WhatsAppUnreachable');
    }
    if (!response.ok) throw new ChannelSendError(`WhatsApp${response.status}`);
  }

  sendCode(to: string, code: string): Promise<void> {
    // The code appears twice: in the body and in the copy-code button (sub_type url, index 0).
    return this.send(to, 'VERIFY', [
      { type: 'body', parameters: [{ type: 'text', text: code }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
    ]);
  }

  sendTemplate(to: string, template: Exclude<WhatsAppTemplate, 'VERIFY'>, link: string): Promise<void> {
    return this.send(to, template, [{ type: 'body', parameters: [{ type: 'text', text: link }] }]);
  }

  verifySignature(rawBody: Uint8Array, headers: Headers): boolean {
    return verifyMetaSignature(this.options.appSecret, rawBody, headers.get('x-hub-signature-256'));
  }

  verifySubscription(query: { mode?: string; token?: string; challenge?: string }): string | null {
    return verifyMetaSubscription(this.options.verifyToken, query);
  }

  parseInbound(rawBody: Uint8Array): WhatsAppInbound[] {
    return parseWhatsAppInbound(rawBody);
  }
}

export function verifyMetaSignature(secret: string, rawBody: Uint8Array, header: string | null): boolean {
  const given = /^sha256=([0-9a-f]{64})$/i.exec(header ?? '')?.[1];
  if (!given) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(given, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyMetaSubscription(verifyToken: string, query: { mode?: string; token?: string; challenge?: string }): string | null {
  if (query.mode !== 'subscribe' || !query.challenge || !/^[A-Za-z0-9_-]{1,128}$/.test(query.challenge)) return null;
  const expected = Buffer.from(verifyToken);
  const actual = Buffer.from(query.token ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? query.challenge : null;
}

/** Text messages from people, as `{ from: '+<digits>', text }`. Status updates and other types are skipped. */
export function parseWhatsAppInbound(rawBody: Uint8Array): WhatsAppInbound[] {
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return [];
  }
  const entries = (body as { object?: string; entry?: unknown[] })?.entry;
  if ((body as { object?: string })?.object !== 'whatsapp_business_account' || !Array.isArray(entries)) return [];
  const out: WhatsAppInbound[] = [];
  for (const entry of entries.slice(0, 100)) {
    for (const change of ((entry as { changes?: unknown[] })?.changes ?? []).slice(0, 100)) {
      const value = (change as { field?: string; value?: { messages?: unknown[] } })?.value;
      for (const message of (value?.messages ?? []).slice(0, 1000)) {
        const m = message as { from?: string; type?: string; text?: { body?: string } };
        // `from` is omitted when the user uses a username; such a sender cannot have verified a number with us.
        if (m.type === 'text' && typeof m.from === 'string' && /^[1-9]\d{6,14}$/.test(m.from) && typeof m.text?.body === 'string') {
          out.push({ from: `+${m.from}`, text: m.text.body.slice(0, 200) });
        }
      }
    }
  }
  return out;
}
