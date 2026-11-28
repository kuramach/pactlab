import { describe, expect, it } from 'vitest';
import { CHANNEL_PREFIX, CHANNEL_SENDER } from '../contacts';
import {
  ALERT_CHANNELS,
  ALERT_DAILY_CAP,
  ALERT_FOLD_MINUTES,
  DEFAULT_ALERT_CHANNELS,
  DEFAULT_NOTIFICATION_SETTINGS,
  alertChannelOn,
  decideAlert,
  planAlert,
  pushPayload,
} from './index';

const PACT = '0190a3b4-0000-7000-8000-000000000001';
const OTHER = '0190a3b4-0000-7000-8000-000000000002';
const NOW = new Date('2026-11-27T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe('urgent alerts (T-146)', () => {
  it('only "act now" goes to a channel; a pact set to in-app only never does; quiet hours wait unless opted through', () => {
    const person = DEFAULT_NOTIFICATION_SETTINGS;
    expect(planAlert({ urgency: 'ACT_NOW' }, person, null, NOW)).toBe('ALERT');
    expect(planAlert({ urgency: 'FYI' }, person, null, NOW)).toBe('SKIP');
    expect(planAlert({ urgency: 'ACT_NOW' }, person, { actNow: 'IN_APP', fyi: null }, NOW)).toBe('SKIP');
    const quiet = { ...person, quietStart: 11 * 60, quietEnd: 13 * 60 };
    expect(planAlert({ urgency: 'ACT_NOW' }, quiet, null, NOW)).toBe('WAIT');
    expect(planAlert({ urgency: 'ACT_NOW' }, { ...quiet, actNowThroughQuiet: true }, null, NOW)).toBe('ALERT');
  });

  it('every channel is on until the person turns it off', () => {
    for (const channel of ALERT_CHANNELS) expect(alertChannelOn(DEFAULT_ALERT_CHANNELS, channel)).toBe(true);
    expect(alertChannelOn({ off: ['TELEGRAM'] }, 'TELEGRAM')).toBe(false);
    expect(alertChannelOn({ off: ['TELEGRAM'] }, 'WEB_PUSH')).toBe(true);
  });

  it('folds a pact’s events into one alert per 15 minutes, other pacts unaffected', () => {
    const sent = [{ dealId: PACT, at: minutesAgo(ALERT_FOLD_MINUTES - 1) }];
    expect(decideAlert(sent, PACT, NOW)).toBe('FOLD');
    expect(decideAlert(sent, OTHER, NOW)).toBe('ALERT');
    expect(decideAlert([{ dealId: PACT, at: minutesAgo(ALERT_FOLD_MINUTES) }], PACT, NOW)).toBe('ALERT');
  });

  it('caps a person at 10 alerts in any 24 hours, across every pact', () => {
    const sent = Array.from({ length: ALERT_DAILY_CAP }, (_, index) => ({ dealId: `${index}`, at: minutesAgo(60 + index) }));
    expect(decideAlert(sent, PACT, NOW)).toBe('CAPPED');
    expect(decideAlert(sent.slice(1), PACT, NOW)).toBe('ALERT');
    expect(decideAlert(sent.map((alert) => ({ ...alert, at: minutesAgo(24 * 60 + 1) })), PACT, NOW)).toBe('ALERT');
  });

  it('the push payload is the shared template and nothing else: it takes no pact, so it cannot carry one', () => {
    const payload = pushPayload();
    expect(Object.keys(payload).sort()).toEqual(['badge', 'body', 'icon', 'tag', 'title', 'url']);
    expect(payload.title).toBe(CHANNEL_SENDER);
    expect(payload.body.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
    expect(payload.url).toBe('/notifications');
    // No figures, currency, ids or placeholders.
    expect(Object.values(payload).join(" ")).not.toMatch(/[$€£¥{}]|\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(pushPayload.length).toBeLessThanOrEqual(2);
    expect(pushPayload('TEST').body).toMatch(/^Pactlab: This is a test alert/);
  });
});
