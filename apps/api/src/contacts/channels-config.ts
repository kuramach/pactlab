import { BotFrameworkTeamsBot, FixtureSlackApp, FixtureTeamsBot, FixtureTelegramBot, FixtureWhatsAppSender, SlackWebApi, TelegramBotApi, WhatsAppCloudApi, type SlackApp, type TeamsBot, type TelegramBot, type WhatsAppSender } from '@pactlab/connectors';
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
  /** Slack (T-181, ADR 0065): Pactlab's Slack app. All three or none. */
  SLACK_CLIENT_ID: optional,
  SLACK_CLIENT_SECRET: optional,
  SLACK_SIGNING_SECRET: optional,
  /** Microsoft Teams: the Azure bot's Microsoft App ID and client secret; the token tenant (`botframework.com` for multi-tenant). */
  TEAMS_BOT_APP_ID: optional,
  TEAMS_BOT_APP_PASSWORD: optional,
  TEAMS_BOT_TOKEN_TENANT: optional,
  /** Outside production only: `fixture` runs both channels without Telegram or Meta (local runs, e2e). */
  CONTACT_CHANNELS: z.preprocess(unset, z.enum(['fixture']).optional()),
});

export interface ChannelAdapters {
  readonly telegram: TelegramBot | null;
  readonly whatsapp: WhatsAppSender | null;
  readonly slack: SlackApp | null;
  readonly teams: TeamsBot | null;
}

/** The fixture WhatsApp renders the shared words, so what a test reads is what a person would read. */
export function fixtureWhatsApp(): FixtureWhatsAppSender {
  return new FixtureWhatsAppSender(undefined, undefined, (template, link) => channelMessage(template, { link }));
}

export function channelAdapters(env: NodeJS.ProcessEnv, appEnv: string): ChannelAdapters {
  const value = channelsEnvSchema.parse(env);
  if (value.CONTACT_CHANNELS === 'fixture') {
    if (appEnv === 'production') throw new Error('CONTACT_CHANNELS=fixture is refused in production');
    return { telegram: new FixtureTelegramBot(), whatsapp: fixtureWhatsApp(), slack: new FixtureSlackApp(), teams: new FixtureTeamsBot() };
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
  const slackParts = [value.SLACK_CLIENT_ID, value.SLACK_CLIENT_SECRET, value.SLACK_SIGNING_SECRET];
  if (slackParts.some(Boolean) && !slackParts.every(Boolean)) throw new Error('Slack needs SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET together');
  const slack =
    value.SLACK_CLIENT_ID && value.SLACK_CLIENT_SECRET && value.SLACK_SIGNING_SECRET
      ? new SlackWebApi({ clientId: value.SLACK_CLIENT_ID, clientSecret: value.SLACK_CLIENT_SECRET, signingSecret: value.SLACK_SIGNING_SECRET })
      : null;
  if (Boolean(value.TEAMS_BOT_APP_ID) !== Boolean(value.TEAMS_BOT_APP_PASSWORD)) throw new Error('Teams needs TEAMS_BOT_APP_ID and TEAMS_BOT_APP_PASSWORD together');
  const teams =
    value.TEAMS_BOT_APP_ID && value.TEAMS_BOT_APP_PASSWORD
      ? new BotFrameworkTeamsBot({ appId: value.TEAMS_BOT_APP_ID, appPassword: value.TEAMS_BOT_APP_PASSWORD, ...(value.TEAMS_BOT_TOKEN_TENANT ? { tokenTenant: value.TEAMS_BOT_TOKEN_TENANT } : {}) })
      : null;
  return { telegram, whatsapp, slack, teams };
}
