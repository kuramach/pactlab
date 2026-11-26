import type { NotificationUrgency } from './catalog';

/** How a person hears of one urgency: an email at once, a line in their digest, or the in-app inbox only. */
export const EMAIL_MODES = ['EMAIL_NOW', 'EMAIL_DIGEST', 'IN_APP'] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];

export const DIGEST_CADENCES = ['HOURLY', 'DAILY'] as const;
export type DigestCadence = (typeof DIGEST_CADENCES)[number];

export const EMAIL_MODE_LABELS = {
  EMAIL_NOW: 'Email me immediately',
  EMAIL_DIGEST: 'Put it in my digest',
  IN_APP: 'In Pactlab only',
} as const satisfies Record<EmailMode, string>;

export const DIGEST_CADENCE_LABELS = { HOURLY: 'Hourly', DAILY: 'Daily, at 08:00' } as const satisfies Record<DigestCadence, string>;

/** A person's notification settings (Settings → Notifications). Quiet hours are minutes after local midnight. */
export interface NotificationSettings {
  readonly actNow: EmailMode;
  readonly fyi: EmailMode;
  readonly digest: DigestCadence;
  /** IANA time zone, e.g. Europe/London. */
  readonly timeZone: string;
  readonly quietStart: number | null;
  readonly quietEnd: number | null;
  /** "Act now" emails go out during quiet hours too. */
  readonly actNowThroughQuiet: boolean;
}

/** A per-pact override: a mode per urgency, or null to follow the person's setting. */
export interface PactNotificationOverride {
  readonly actNow: EmailMode | null;
  readonly fyi: EmailMode | null;
}

/** Act now goes immediately by email; for your information goes in a daily digest. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  actNow: 'EMAIL_NOW',
  fyi: 'EMAIL_DIGEST',
  digest: 'DAILY',
  timeZone: 'UTC',
  quietStart: null,
  quietEnd: null,
  actNowThroughQuiet: false,
};

/** The local hour a daily digest goes out at. */
export const DAILY_DIGEST_MINUTE = 8 * 60;

/** The mode that applies to one notification: the pact's override first, then the person's setting. */
export function resolveEmailMode(urgency: NotificationUrgency, person: NotificationSettings, override: PactNotificationOverride | null): EmailMode {
  const fromPact = urgency === 'ACT_NOW' ? override?.actNow : override?.fyi;
  return fromPact ?? (urgency === 'ACT_NOW' ? person.actNow : person.fyi);
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
