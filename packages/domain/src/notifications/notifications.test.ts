import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_TYPES,
  digestSlotStart,
  inQuietHours,
  isPactLink,
  isValidTimeZone,
  localMinutes,
  notificationLink,
  planEmail,
  resolveEmailMode,
  type NotificationSettings,
} from './index';

const DEAL = '0190a3b4-0000-7000-8000-000000000001';
const at = (iso: string) => new Date(iso);
const settings = (patch: Partial<NotificationSettings> = {}): NotificationSettings => ({ ...DEFAULT_NOTIFICATION_SETTINGS, ...patch });

describe('the event catalogue', () => {
  it('gives every event an urgency, plain words and a place in the pact', () => {
    for (const type of NOTIFICATION_EVENT_TYPES) {
      const definition = NOTIFICATION_EVENTS[type];
      expect(['ACT_NOW', 'FYI']).toContain(definition.urgency);
      // Plain words only: no figures or placeholders a caller could fill with an amount.
      expect(definition.title).not.toMatch(/[\d$€£%{}]/);
      expect(isPactLink(notificationLink(type, DEAL), DEAL)).toBe(true);
    }
  });

  it('keeps the brief’s split between act now and for your information', () => {
    const actNow = NOTIFICATION_EVENT_TYPES.filter((type) => NOTIFICATION_EVENTS[type].urgency === 'ACT_NOW');
    expect(actNow).toEqual(['SIGNATURE_REQUESTED', 'TERMS_PROPOSED', 'TERMS_COUNTERED', 'DEADLINE_NEAR', 'IC_DECIDED', 'QUESTION_ASKED']);
  });

  it('links a finding to the finding itself, and refuses links outside the pact', () => {
    const finding = '0190a3b4-0000-7000-8000-0000000000ff';
    expect(notificationLink('FINDING_DRAFTED', DEAL, finding)).toBe(`/deals/${DEAL}/findings/${finding}`);
    expect(isPactLink('https://evil.example/x', DEAL)).toBe(false);
    expect(isPactLink(`/deals/${DEAL}/../admin`, DEAL)).toBe(false);
    expect(isPactLink('/deals/0190a3b4-0000-7000-8000-000000000002/terms', DEAL)).toBe(false);
  });
});

describe('preferences', () => {
  it('defaults: act now by email at once, for your information in the daily digest', () => {
    expect(resolveEmailMode('ACT_NOW', DEFAULT_NOTIFICATION_SETTINGS, null)).toBe('EMAIL_NOW');
    expect(resolveEmailMode('FYI', DEFAULT_NOTIFICATION_SETTINGS, null)).toBe('EMAIL_DIGEST');
    expect(DEFAULT_NOTIFICATION_SETTINGS.digest).toBe('DAILY');
  });

  it('a pact override wins per urgency, and null follows the person', () => {
    const person = settings({ fyi: 'IN_APP' });
    expect(resolveEmailMode('FYI', person, { actNow: null, fyi: 'EMAIL_NOW' })).toBe('EMAIL_NOW');
    expect(resolveEmailMode('ACT_NOW', person, { actNow: null, fyi: 'EMAIL_NOW' })).toBe('EMAIL_NOW');
    expect(resolveEmailMode('FYI', person, { actNow: 'IN_APP', fyi: null })).toBe('IN_APP');
  });

  it('knows a real time zone from a made-up one', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('quiet hours', () => {
  const quiet = settings({ timeZone: 'America/New_York', quietStart: 22 * 60, quietEnd: 7 * 60 });

  it('reads the clock in the person’s own time zone, across midnight', () => {
    expect(localMinutes(at('2026-11-25T03:30:00Z'), 'America/New_York')).toBe(22 * 60 + 30);
    expect(inQuietHours(at('2026-11-25T03:30:00Z'), quiet)).toBe(true); // 22:30 in New York
    expect(inQuietHours(at('2026-11-25T11:30:00Z'), quiet)).toBe(true); // 06:30
    expect(inQuietHours(at('2026-11-25T12:30:00Z'), quiet)).toBe(false); // 07:30
  });

  it('has none when unset or empty', () => {
    expect(inQuietHours(at('2026-11-25T03:30:00Z'), settings())).toBe(false);
    expect(inQuietHours(at('2026-11-25T03:30:00Z'), settings({ quietStart: 60, quietEnd: 60 }))).toBe(false);
  });
});

describe('planning an email', () => {
  const now = at('2026-11-25T15:00:00Z');
  const actNow = { urgency: 'ACT_NOW' as const, mode: 'EMAIL_NOW' as const, createdAt: at('2026-11-25T14:59:00Z') };

  it('sends act now at once, and never emails what is in-app only', () => {
    expect(planEmail(actNow, settings(), now, null)).toBe('SEND_NOW');
    expect(planEmail({ ...actNow, mode: 'IN_APP' }, settings(), now, null)).toBe('IN_APP_ONLY');
  });

  it('holds act now through quiet hours unless the person opted it through', () => {
    const quiet = settings({ quietStart: 14 * 60, quietEnd: 16 * 60 });
    expect(planEmail(actNow, quiet, now, null)).toBe('WAIT');
    expect(planEmail(actNow, quiet, at('2026-11-25T16:00:00Z'), null)).toBe('SEND_NOW');
    expect(planEmail(actNow, { ...quiet, actNowThroughQuiet: true }, now, null)).toBe('SEND_NOW');
  });

  it('puts a digest item in the next daily slot, once', () => {
    const item = { urgency: 'FYI' as const, mode: 'EMAIL_DIGEST' as const, createdAt: at('2026-11-25T10:00:00Z') };
    // The same day, after today's 08:00 slot: tomorrow's digest.
    expect(planEmail(item, settings(), at('2026-11-25T23:00:00Z'), null)).toBe('WAIT');
    expect(planEmail(item, settings(), at('2026-11-26T08:01:00Z'), null)).toBe('DIGEST_NOW');
    // A digest already went out in this slot: the next one.
    expect(planEmail(item, settings(), at('2026-11-26T08:30:00Z'), at('2026-11-26T08:02:00Z'))).toBe('WAIT');
  });

  it('runs an hourly digest at the top of each hour', () => {
    const hourly = settings({ digest: 'HOURLY' });
    const item = { urgency: 'FYI' as const, mode: 'EMAIL_DIGEST' as const, createdAt: at('2026-11-25T10:15:00Z') };
    expect(planEmail(item, hourly, at('2026-11-25T10:50:00Z'), null)).toBe('WAIT');
    expect(planEmail(item, hourly, at('2026-11-25T11:05:00Z'), null)).toBe('DIGEST_NOW');
    expect(digestSlotStart(at('2026-11-25T11:05:30Z'), hourly).toISOString()).toBe('2026-11-25T11:00:00.000Z');
  });

  it('places the daily slot at 08:00 in the person’s time zone', () => {
    expect(digestSlotStart(at('2026-11-25T15:00:00Z'), settings({ timeZone: 'America/New_York' })).toISOString()).toBe('2026-11-25T13:00:00.000Z');
    expect(digestSlotStart(at('2026-11-25T12:00:00Z'), settings({ timeZone: 'America/New_York' })).toISOString()).toBe('2026-11-24T13:00:00.000Z');
  });
});
