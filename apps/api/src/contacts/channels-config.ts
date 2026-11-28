import { loadConfig, messagingEnvSchema } from '@pactlab/config';
import { BotFrameworkTeamsBot, FixtureSlackApp, FixtureTeamsBot, FixtureTelegramBot, FixtureWebPush, FixtureWhatsAppSender, SlackWebApi, TelegramBotApi, VapidWebPush, WhatsAppCloudApi, type SlackApp, type TeamsBot, type TelegramBot, type WebPushSender, type WhatsAppSender } from '@pactlab/connectors';
import { channelMessage } from '@pactlab/domain';

/**
 * Message-channel and web-push adapters (T-180, T-181, T-146). The variables are validated by
 * `messagingEnvSchema` in @pactlab/config: every channel is off by default, and a partly set group
 * fails at startup, so a half-configured bot never runs. Values are secrets: never logged.
 */

export interface ChannelAdapters {
  readonly telegram: TelegramBot | null;
  readonly whatsapp: WhatsAppSender | null;
  readonly slack: SlackApp | null;
  readonly teams: TeamsBot | null;
  /** Web push on a person's devices (T-146): VAPID, no third-party service. */
  readonly push: WebPushSender | null;
}

/** The fixture WhatsApp renders the shared words, so what a test reads is what a person would read. */
export function fixtureWhatsApp(): FixtureWhatsAppSender {
  return new FixtureWhatsAppSender(undefined, undefined, (template, link) => channelMessage(template, { link }));
}

export function channelAdapters(env: NodeJS.ProcessEnv, appEnv: string): ChannelAdapters {
  const value = loadConfig(messagingEnvSchema, { ...env, APP_ENV: appEnv });
  if (value.CONTACT_CHANNELS === 'fixture') {
    return { telegram: new FixtureTelegramBot(), whatsapp: fixtureWhatsApp(), slack: new FixtureSlackApp(), teams: new FixtureTeamsBot(), push: new FixtureWebPush() };
  }
  const telegram =
    value.TELEGRAM_BOT_TOKEN && value.TELEGRAM_BOT_USERNAME && value.TELEGRAM_WEBHOOK_SECRET
      ? new TelegramBotApi({ token: value.TELEGRAM_BOT_TOKEN, username: value.TELEGRAM_BOT_USERNAME, webhookSecret: value.TELEGRAM_WEBHOOK_SECRET })
      : null;
  let whatsapp: WhatsAppSender | null = null;
  if (value.WHATSAPP_ENABLED === 'true') {
    if (!value.WHATSAPP_ACCESS_TOKEN || !value.WHATSAPP_PHONE_NUMBER_ID || !value.WHATSAPP_APP_SECRET || !value.WHATSAPP_VERIFY_TOKEN) throw new Error('unreachable: messagingEnvSchema requires them');
    whatsapp = new WhatsAppCloudApi({
      accessToken: value.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: value.WHATSAPP_PHONE_NUMBER_ID,
      appSecret: value.WHATSAPP_APP_SECRET,
      verifyToken: value.WHATSAPP_VERIFY_TOKEN,
      apiVersion: value.WHATSAPP_API_VERSION,
    });
  }
  const slack =
    value.SLACK_CLIENT_ID && value.SLACK_CLIENT_SECRET && value.SLACK_SIGNING_SECRET
      ? new SlackWebApi({ clientId: value.SLACK_CLIENT_ID, clientSecret: value.SLACK_CLIENT_SECRET, signingSecret: value.SLACK_SIGNING_SECRET })
      : null;
  const teams =
    value.TEAMS_BOT_APP_ID && value.TEAMS_BOT_APP_PASSWORD
      ? new BotFrameworkTeamsBot({ appId: value.TEAMS_BOT_APP_ID, appPassword: value.TEAMS_BOT_APP_PASSWORD, ...(value.TEAMS_BOT_TOKEN_TENANT ? { tokenTenant: value.TEAMS_BOT_TOKEN_TENANT } : {}) })
      : null;
  const push =
    value.VAPID_PUBLIC_KEY && value.VAPID_PRIVATE_KEY && value.VAPID_SUBJECT
      ? new VapidWebPush({ publicKey: value.VAPID_PUBLIC_KEY, privateKey: value.VAPID_PRIVATE_KEY, subject: value.VAPID_SUBJECT })
      : null;
  return { telegram, whatsapp, slack, teams, push };
}
