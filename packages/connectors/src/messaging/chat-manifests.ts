import { SLACK_BOT_SCOPES } from './slack.adapter';

/**
 * The Slack app and Teams app definitions (T-181, ADR 0065), with Pactlab's branding (Kumar, 2026-11-27):
 * the name "Pactlab", the tagline as the description, Pactlab navy as the background or accent colour, and
 * the icon the emails use (`apps/api/assets/brand/pactlab-icon.png`; Slack takes it in the app settings,
 * Teams as `color.png` and `outline.png` in the app package). The runbook prints both for Kumar's setup.
 */

/** The brand the emails carry (`branded-email.ts`): navy, the name and the tagline. */
export const CHAT_BRAND = {
  name: 'Pactlab',
  tagline: 'Test the pact before you sign it.',
  description: 'Test the pact before you sign it. Pactlab messages you here when a pact needs you, with no deal details.',
  navy: '#081127',
  website: 'https://pactlab.ai',
  privacy: 'https://pactlab.ai/privacy',
  terms: 'https://pactlab.ai/terms',
} as const;

/** A Slack app manifest (docs.slack.dev, "App manifest reference"): paste it when creating the app "from a manifest". */
export function slackAppManifest(input: { apiOrigin: string; webOrigin: string }) {
  return {
    display_information: { name: CHAT_BRAND.name, description: CHAT_BRAND.tagline, background_color: CHAT_BRAND.navy },
    features: {
      app_home: { home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: true },
      bot_user: { display_name: CHAT_BRAND.name, always_online: true },
    },
    oauth_config: { redirect_urls: [new URL('/settings/chat-apps/slack/callback', input.webOrigin).toString()], scopes: { bot: [...SLACK_BOT_SCOPES] } },
    settings: {
      event_subscriptions: { request_url: new URL('/v1/webhooks/slack/events', input.apiOrigin).toString(), bot_events: ['app_home_opened', 'app_uninstalled', 'tokens_revoked'] },
      interactivity: { is_enabled: true, request_url: new URL('/v1/webhooks/slack/interactions', input.apiOrigin).toString() },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/**
 * A Teams app manifest (schema 1.19, learn.microsoft.com "App manifest schema"): a personal-scope bot only,
 * so Pactlab can message the person and nothing else. Zipped with `color.png` (192×192) and
 * `outline.png` (32×32, white on transparent) for the admin to upload in the Teams admin centre.
 */
export function teamsAppManifest(input: { botAppId: string; version: string; webOrigin: string }) {
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.19/MicrosoftTeams.schema.json',
    manifestVersion: '1.19',
    version: input.version,
    id: input.botAppId,
    developer: { name: CHAT_BRAND.name, websiteUrl: CHAT_BRAND.website, privacyUrl: CHAT_BRAND.privacy, termsOfUseUrl: CHAT_BRAND.terms },
    name: { short: CHAT_BRAND.name, full: CHAT_BRAND.name },
    description: { short: CHAT_BRAND.tagline, full: CHAT_BRAND.description },
    icons: { color: 'color.png', outline: 'outline.png' },
    accentColor: CHAT_BRAND.navy,
    bots: [{ botId: input.botAppId, scopes: ['personal'], supportsFiles: false, isNotificationOnly: false }],
    permissions: ['identity'],
    validDomains: [new URL(input.webOrigin).hostname],
  };
}
