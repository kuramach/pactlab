import type { NotificationUrgency } from './catalog';
import { DAILY_DIGEST_MINUTE, type EmailMode, type NotificationSettings } from './preferences';

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** Minutes after local midnight in `timeZone` (an unknown zone reads as UTC). */
export function localMinutes(now: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (value('hour') % 24) * 60 + value('minute');
}

/** Whether `now` falls in the person's quiet hours. A window may cross midnight (22:00–07:00). */
export function inQuietHours(now: Date, settings: Pick<NotificationSettings, 'timeZone' | 'quietStart' | 'quietEnd'>): boolean {
  const { quietStart: start, quietEnd: end } = settings;
  if (start === null || end === null || start === end) return false;
  const minute = localMinutes(now, settings.timeZone);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * The start of the digest slot `now` falls in: the top of the hour (hourly), or the most recent
 * local 08:00 (daily). Measured from the local clock now, so a daylight-saving change inside the
 * day moves the slot by that hour, once.
 */
export function digestSlotStart(now: Date, settings: Pick<NotificationSettings, 'digest' | 'timeZone'>): Date {
  const whole = Math.floor(now.getTime() / MINUTE) * MINUTE;
  if (settings.digest === 'HOURLY') return new Date(Math.floor(now.getTime() / (60 * MINUTE)) * 60 * MINUTE);
  const sinceSlot = (localMinutes(now, settings.timeZone) - DAILY_DIGEST_MINUTE + DAY_MINUTES) % DAY_MINUTES;
  return new Date(whole - sinceSlot * MINUTE);
}

/** What the dispatcher does with one pending notification now. */
export type EmailPlan = 'SEND_NOW' | 'DIGEST_NOW' | 'WAIT' | 'IN_APP_ONLY';

/**
 * - In-app only: never emailed.
 * - Quiet hours hold every email, unless it is "act now", sent immediately, and the person opted it through.
 * - Immediate: now.
 * - Digest: in the first digest slot after it happened, once per slot (a digest already sent in this
 *   slot means the item waits for the next one).
 */
export function planEmail(
  item: { readonly urgency: NotificationUrgency; readonly mode: EmailMode; readonly createdAt: Date },
  settings: NotificationSettings,
  now: Date,
  lastDigestAt: Date | null,
): EmailPlan {
  if (item.mode === 'IN_APP') return 'IN_APP_ONLY';
  const throughQuiet = item.urgency === 'ACT_NOW' && item.mode === 'EMAIL_NOW' && settings.actNowThroughQuiet;
  if (!throughQuiet && inQuietHours(now, settings)) return 'WAIT';
  if (item.mode === 'EMAIL_NOW') return 'SEND_NOW';
  const slot = digestSlotStart(now, settings);
  const due = item.createdAt.getTime() < slot.getTime() && (lastDigestAt === null || lastDigestAt.getTime() < slot.getTime());
  return due ? 'DIGEST_NOW' : 'WAIT';
}
