import type { LineBot, TelegramBot, WhatsAppSender } from '@pactlab/connectors';
import type { EmailSender } from '../email-login/email-sender';
import type { IdentityEmailSource } from './auth0-userinfo';

export const CONTACT_SETTINGS = Symbol('CONTACT_SETTINGS');

export interface ContactModuleSettings {
  /** Null: confirmation codes are never delivered (tests inject a recording sender). */
  readonly emailSender: EmailSender | null;
  readonly hashSecret: string;
  /** The web origin links point into. */
  readonly appOrigin: string;
  /** Auth0's `/userinfo` for the verified email claim; null where Auth0 is not configured. */
  readonly identityEmails: IdentityEmailSource | null;
  /** The Telegram bot (T-180): off (null) unless a bot token is set; the fixture outside production. */
  readonly telegram: TelegramBot | null;
  /** WhatsApp: off (null) unless enabled after Kumar's approval (ADR 0064); the fixture in tests. */
  readonly whatsapp: WhatsAppSender | null;
  /** LINE (T-182): off (null) unless the Pactlab LINE Official Account is configured; the fixture in tests. */
  readonly line?: LineBot | null;
  /** Pushes a month before sends stop; never more than the free allowance until a paid plan is approved. */
  readonly lineAllowance?: number;
}

