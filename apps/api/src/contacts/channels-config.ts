import { FixtureTelegramBot, FixtureWhatsAppSender, TelegramBotApi, WhatsAppCloudApi, type TelegramBot, type WhatsAppSender } from '@pactlab/connectors';
import { channelMessage } from '@pactlab/domain';
import { z } from 'zod';

/**
 * Message-channel configuration (T-180). Read here rather than in @pactlab/config until that package
 * takes these names (follow-up; ADR 0064). Both channels are off by default. Partly set fails closed
 * at startup, so a half-configured bot never runs. Values are secrets: never logged.
 */
const unset = (value: unknown) => (value === '' || value === 'unset' ? undefined : value);
const optional = z.preprocess(unset, z.string().min(1).optional());

const channelsEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_BOT_USERNAME: optional,
  TELEGRAM_WEBHOOK_SECRET: optional,
  /** WhatsApp is paid per message: `true` only once Kumar's approval is recorded (ADR 0064, runbook). */
  WHATSAPP_ENABLED: z.preprocess(unset, z.enum(['true', 'false']).default('false')),
  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  WHATSAPP_API_VERSION: z.preprocess(unset, z.string().regex(/^v\d+\.\d+$/).default('v27.0')),
  /** Outside production only: `fixture` runs both channels without Telegram or Meta (local runs, e2e). */
  CONTACT_CHANNELS: z.preprocess(unset, z.enum(['fixture']).optional()),
});

export interface ChannelAdapters {
  readonly telegram: TelegramBot | null;
  readonly whatsapp: WhatsAppSender | null;
}

/** The fixture WhatsApp renders the shared words, so what a test reads is what a person would read. */
export function fixtureWhatsApp(): FixtureWhatsAppSender {
  return new FixtureWhatsAppSender(undefined, undefined, (template, link) => channelMessage(template, { link }));
}

export function channelAdapters(env: NodeJS.ProcessEnv, appEnv: string): ChannelAdapters {
  const value = channelsEnvSchema.parse(env);
  if (value.CONTACT_CHANNELS === 'fixture') {
    if (appEnv === 'production') throw new Error('CONTACT_CHANNELS=fixture is refused in production');
    return { telegram: new FixtureTelegramBot(), whatsapp: fixtureWhatsApp() };
  }
  const telegramParts = [value.TELEGRAM_BOT_TOKEN, value.TELEGRAM_BOT_USERNAME, value.TELEGRAM_WEBHOOK_SECRET];
  if (telegramParts.some(Boolean) && !telegramParts.every(Boolean)) throw new Error('Telegram needs TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET together');
  const telegram =
    value.TELEGRAM_BOT_TOKEN && value.TELEGRAM_BOT_USERNAME && value.TELEGRAM_WEBHOOK_SECRET
      ? new TelegramBotApi({ token: value.TELEGRAM_BOT_TOKEN, username: value.TELEGRAM_BOT_USERNAME, webhookSecret: value.TELEGRAM_WEBHOOK_SECRET })
      : null;
  let whatsapp: WhatsAppSender | null = null;
  if (value.WHATSAPP_ENABLED === 'true') {
    if (!value.WHATSAPP_ACCESS_TOKEN || !value.WHATSAPP_PHONE_NUMBER_ID || !value.WHATSAPP_APP_SECRET || !value.WHATSAPP_VERIFY_TOKEN) {
      throw new Error('WHATSAPP_ENABLED needs WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN');
    }
    whatsapp = new WhatsAppCloudApi({
      accessToken: value.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: value.WHATSAPP_PHONE_NUMBER_ID,
      appSecret: value.WHATSAPP_APP_SECRET,
      verifyToken: value.WHATSAPP_VERIFY_TOKEN,
      apiVersion: value.WHATSAPP_API_VERSION,
    });
  }
  return { telegram, whatsapp };
}
