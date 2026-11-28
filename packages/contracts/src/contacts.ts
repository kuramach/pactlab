import { z } from 'zod';
import { pageQuerySchema } from './pagination';

/**
 * Contact details in the profile (T-180, T-182; ADR 0064): the person's verified email, and Telegram,
 * WhatsApp and LINE as message channels. The API validates every write here. Values are personal data.
 */

export const contactEmailStartSchema = z.object({ email: z.string().trim().min(3).max(254) }).strict();
export type ContactEmailStartBody = z.infer<typeof contactEmailStartSchema>;

export const contactCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type ContactCodeBody = z.infer<typeof contactCodeSchema>;

export const whatsappStartSchema = z
  .object({
    /** As typed; read into E.164 with the picker's country code. */
    number: z.string().trim().min(4).max(32),
    /** The picker's country calling code, digits only. */
    dial: z.string().regex(/^[1-9]\d{0,2}$/).optional(),
    /** The person ticked the consent shown; the server stores its own copy of the text. */
    consent: z.literal(true),
  })
  .strict();
export type WhatsAppStartBody = z.infer<typeof whatsappStartSchema>;

export const contactChannelParamsSchema = z.object({ channelId: z.uuid() }).strict();

export const contactAdminQuerySchema = pageQuerySchema;

export type ContactChannelKindView = 'TELEGRAM' | 'WHATSAPP' | 'LINE';

export interface ContactChannelView {
  readonly id: string;
  readonly kind: ContactChannelKindView;
  /** The person's own value: the WhatsApp number in E.164; for Telegram and LINE, "Connected" only. */
  readonly label: string;
  readonly verifiedAt: string;
  readonly consentedAt: string | null;
}

export interface ContactProfileView {
  readonly displayName: string;
  readonly email: { readonly address: string; readonly verified: boolean; readonly source: 'AUTH0_CLAIM' | 'CODE' | 'SIGN_IN' } | null;
  /** The one-time banner: shown until the person has a verified email. */
  readonly askForEmail: boolean;
  readonly channels: readonly ContactChannelView[];
  /** What this deployment offers; a channel that is off cannot be connected. */
  readonly available: { readonly telegram: boolean; readonly whatsapp: boolean; readonly line: boolean };
  /** LINE (T-182): the URL that opens the Pactlab account's add-friend screen, when LINE is set up. */
  readonly lineAddFriendUrl: string | null;
  /** The consent text shown before a WhatsApp number is verified. */
  readonly whatsappConsentText: string;
}

export interface TelegramLinkView {
  /** `https://t.me/<bot>?start=<token>`: single use, 10 minutes. */
  readonly url: string;
  readonly expiresAt: string;
}

export interface MaskedMemberContactView {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly telegram: string | null;
  readonly whatsapp: string | null;
  readonly line: string | null;
}

/** Back from LINE Login (T-182): the code and state LINE put on the redirect. */
export const lineCallbackSchema = z
  .object({
    code: z.string().min(1).max(512).regex(/^[A-Za-z0-9._~-]+$/),
    state: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  })
  .strict();
export type LineCallbackBody = z.infer<typeof lineCallbackSchema>;

export interface LineLinkView {
  /** LINE Login's authorization URL: single use, 10 minutes. */
  readonly url: string;
  readonly expiresAt: string;
}

export interface LineCallbackView {
  /** CONNECTED: a friend already, so LINE is connected. ADD_FRIEND: add the account within 15 minutes to finish. */
  readonly status: 'CONNECTED' | 'ADD_FRIEND';
  readonly addFriendUrl: string;
}

/** Operators (T-182): this month's LINE allowance. Counts only; no person or user id. */
export interface LineAllowanceView {
  readonly configured: boolean;
  /** The monthly cap Pactlab holds sends to: the free allowance unless a paid plan is approved. */
  readonly allowance: number;
  /** LINE's own count this month, or null when LINE could not be asked. */
  readonly used: number | null;
  readonly reached: boolean;
  /** Pactlab's own counts this month (UTC). */
  readonly sent: number;
  readonly heldBack: number;
  readonly failed: number;
}
