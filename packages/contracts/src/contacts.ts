import { z } from 'zod';
import { pageQuerySchema } from './pagination';

/**
 * Contact details in the profile (T-180, ADR 0064): the person's verified email, and Telegram and
 * WhatsApp as message channels. The API validates every write here. Values are personal data.
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

export type ContactChannelKindView = 'TELEGRAM' | 'WHATSAPP';

export interface ContactChannelView {
  readonly id: string;
  readonly kind: ContactChannelKindView;
  /** The person's own value: the WhatsApp number in E.164; for Telegram, "Connected" only. */
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
  readonly available: { readonly telegram: boolean; readonly whatsapp: boolean };
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
}
