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

export type ContactChannelKindView = 'TELEGRAM' | 'WHATSAPP' | 'SLACK' | 'TEAMS';

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
  readonly available: { readonly telegram: boolean; readonly whatsapp: boolean; readonly slack: boolean; readonly teams: boolean };
  /** Slack and Teams (T-181): whether the organization's admin has installed Pactlab; until then the card asks the admin. */
  readonly chatInstalled: { readonly slack: boolean; readonly teams: boolean };
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

/**
 * Slack and Microsoft Teams (T-181, ADR 0065): an organization admin installs Pactlab once; each person
 * links by their verified email and confirms in Slack or Teams. Workspace, tenant and platform user ids
 * never appear in any response.
 */
export const chatProviderSchema = z.enum(['slack', 'teams']);
export type ChatProviderParam = z.infer<typeof chatProviderSchema>;
export const chatProviderParamsSchema = z.object({ provider: chatProviderSchema }).strict();

export const chatInstallCallbackSchema = z
  .object({
    code: z.string().min(1).max(2048),
    state: z.string().min(1).max(2048),
  })
  .strict();
export type ChatInstallCallbackBody = z.infer<typeof chatInstallCallbackSchema>;

export const chatMembersQuerySchema = pageQuerySchema;

export interface ChatAppView {
  /** This Pactlab has the platform configured (the app or bot registered by Kumar, runbook). */
  readonly available: boolean;
  readonly installed: boolean;
  readonly installedAt: string | null;
  /** Owners and admins: how many members are linked. Null for everyone else. */
  readonly linkedCount: number | null;
}

export interface ChatAppsView {
  readonly slack: ChatAppView;
  readonly teams: ChatAppView;
}

export interface ChatInstallStartView {
  /** Slack's OAuth page, or Microsoft's sign-in page: the browser goes there next. */
  readonly url: string;
}

/** Owners and admins: which members are linked, by name; never their Slack or Teams user id. */
export interface ChatMemberLinkView {
  readonly userId: string;
  readonly displayName: string;
  readonly linked: boolean;
}
