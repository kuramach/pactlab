import { CHANNEL_SENDER, channelMessage } from '../contacts';
import type { NotificationUrgency } from './catalog';
import type { NotificationSettings, PactNotificationOverride } from './preferences';
import { inQuietHours } from './schedule';

/**
 * Urgent pact alerts (T-146): the phone and chat channels an "act now" item may also reach, how often,
 * and the one payload every channel sends. Email stays as T-145 built it; these add to it, never replace it.
 *
 * - Only "act now" events, never "for your information".
 * - Content-free: the shared "Pactlab:" words and a link that needs sign-in, never a pact name, party,
 *   amount, term or document (a lock screen shows it; chat apps sit outside Pactlab's control).
 * - A per-person cap across every channel, and one alert per pact per 15 minutes, later events folded in.
 */

/**
 * The channels, in the order the settings page lists them. WhatsApp is deferred indefinitely (Kumar,
 * 2026-11-27): it stays listed so an existing T-180 channel keeps its preference, but nothing enables it.
 * LINE (T-182) is the Japan channel: free up to the official account's monthly allowance, then email only.
 */
export const ALERT_CHANNELS = ['WEB_PUSH', 'TELEGRAM', 'LINE', 'SLACK', 'TEAMS', 'WHATSAPP'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_CHANNEL_LABELS = {
  WEB_PUSH: 'Alerts on your devices (web push)',
  TELEGRAM: 'Telegram',
  LINE: 'LINE',
  SLACK: 'Slack',
  TEAMS: 'Microsoft Teams',
  WHATSAPP: 'WhatsApp',
} as const satisfies Record<AlertChannel, string>;

/** At most this many alerts reach one person in any 24 hours, across every channel together. */
export const ALERT_DAILY_CAP = 10;
/** One alert per pact per this many minutes; events in between go out together in the next one. */
export const ALERT_FOLD_MINUTES = 15;
/** An "act now" item older than this is never alerted: by then it is in the inbox and the email. */
export const ALERT_MAX_AGE_HOURS = 24;

/** A person's channel choices: every channel is on unless they turned it off (linking one is the opt-in). */
export interface AlertChannelPreferences {
  readonly off: readonly AlertChannel[];
}
export const DEFAULT_ALERT_CHANNELS: AlertChannelPreferences = { off: [] };

export function alertChannelOn(preferences: AlertChannelPreferences, channel: AlertChannel): boolean {
  return !preferences.off.includes(channel);
}

/** Whether an "act now" item may go to the person's channels now: not "for your information", not a pact set to in-app only, not in quiet hours unless opted through. */
export type AlertPlan = 'ALERT' | 'WAIT' | 'SKIP';

export function planAlert(
  item: { readonly urgency: NotificationUrgency },
  person: NotificationSettings,
  override: PactNotificationOverride | null,
  now: Date,
): AlertPlan {
  if (item.urgency !== 'ACT_NOW') return 'SKIP';
  // "In Pactlab only" on this pact means just that: nothing leaves the app for it.
  if (override?.actNow === 'IN_APP') return 'SKIP';
  if (!person.actNowThroughQuiet && inQuietHours(now, person)) return 'WAIT';
  return 'ALERT';
}

/**
 * The cap and the fold for one person and one pact, given the alerts already sent. The database's
 * `app_channel_alert_take` applies the same rule under a per-person lock, so two dispatchers agree.
 * - FOLD: this pact had an alert in the last 15 minutes; wait, and send these with the next one.
 * - CAPPED: the person already had 10 alerts in the last 24 hours; email and the inbox still have it.
 */
export type AlertDecision = 'ALERT' | 'FOLD' | 'CAPPED';

export function decideAlert(sent: readonly { readonly dealId: string; readonly at: Date }[], dealId: string, now: Date): AlertDecision {
  const foldFrom = now.getTime() - ALERT_FOLD_MINUTES * 60_000;
  if (sent.some((alert) => alert.dealId === dealId && alert.at.getTime() > foldFrom)) return 'FOLD';
  const dayFrom = now.getTime() - 24 * 3_600_000;
  return sent.filter((alert) => alert.at.getTime() > dayFrom).length >= ALERT_DAILY_CAP ? 'CAPPED' : 'ALERT';
}

/** What a web push carries: fixed words, a fixed path and the brand. Nothing about any pact can be put in it. */
export interface PushPayload {
  readonly title: typeof CHANNEL_SENDER;
  readonly body: string;
  readonly url: '/notifications';
  readonly icon: string;
  readonly badge: string;
  /** Collapses repeated alerts on a device into one. */
  readonly tag: 'pactlab-act-now';
}

export const PUSH_ICON = '/brand/apple-touch-icon.png';
export const PUSH_BADGE = '/brand/favicon-32.png';

/**
 * The web push payload. It takes no pact, event or person, so it cannot carry one; the words are the
 * shared channel template. The click opens the inbox, which needs sign-in.
 */
export function pushPayload(kind: 'ACT_NOW' | 'TEST' = 'ACT_NOW', locale?: string): PushPayload {
  return {
    title: CHANNEL_SENDER,
    body: channelMessage(kind === 'ACT_NOW' ? 'PUSH_ACT_NOW' : 'PUSH_TEST', locale ? { locale } : {}),
    url: '/notifications',
    icon: PUSH_ICON,
    badge: PUSH_BADGE,
    tag: 'pactlab-act-now',
  };
}
