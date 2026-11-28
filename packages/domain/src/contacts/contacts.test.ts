import { describe, expect, it } from 'vitest';
import { CHANNEL_PREFIX, channelMessage, countryCodeLength, isStopWord, maskContact, normalizeEmail, toE164 } from './index';

describe('contact details (T-180)', () => {
  it('reads numbers into E.164, with or without the picker', () => {
    expect(toE164('+91 98765 43212')).toBe('+919876543212');
    expect(toE164('07700 900123', '44')).toBe('+447700900123');
    expect(toE164('+44 (0)7700 900123')).toBe('+447700900123');
    expect(toE164('(415) 555-0123', '1')).toBe('+14155550123');
    expect(toE164('12345')).toBeNull();
    expect(toE164('98765 43212')).toBeNull();
    expect(toE164('+0123456789')).toBeNull();
    expect(toE164('call me')).toBeNull();
  });

  it('knows the country code length of the launch markets', () => {
    expect(['14155550123', '447700900123', '4915112345678', '33612345678', '919876543212', '819012345678', '35312345678'].map(countryCodeLength)).toEqual([1, 2, 2, 2, 2, 2, 3]);
  });

  it('masks every kind so an admin never sees the value', () => {
    expect(maskContact('WHATSAPP', '+919876543212')).toBe('+91 •••• ••12');
    expect(maskContact('WHATSAPP', '+14155550123')).toBe('+1 •••• ••23');
    expect(maskContact('EMAIL', 'kumar@example.com')).toBe('k•••@example.com');
    expect(maskContact('TELEGRAM', '424242')).toBe('Telegram ••42');
  });

  it('normalizes email addresses', () => {
    expect(normalizeEmail(' Kumar@Example.COM ')).toBe('kumar@example.com');
    expect(normalizeEmail('not-an-address')).toBeNull();
  });

  it('sends one content-free message, prefixed "Pactlab:", on every channel', () => {
    const link = 'https://app.pactlab.ai/notifications';
    for (const kind of ['ACT_NOW', 'TEST', 'LINKED', 'LINK_EXPIRED', 'DISCONNECTED', 'STOPPED'] as const) {
      expect(channelMessage(kind, { link }).startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
    }
    expect(channelMessage('ACT_NOW', { link })).toBe(`Pactlab: A pact needs you. Open Pactlab to see what: ${link}`);
    // An unknown locale falls back to English rather than sending nothing.
    expect(channelMessage('ACT_NOW', { link, locale: 'xx' })).toBe(channelMessage('ACT_NOW', { link }));
  });

  it('recognizes STOP replies', () => {
    expect(['STOP', ' stop ', 'Unsubscribe'].every(isStopWord)).toBe(true);
    expect(isStopWord('please stop the deal')).toBe(false);
  });
});

describe('LINE wording (T-182)', () => {
  const link = 'https://app.pactlab.ai/notifications';
  it('is Japanese for ja readers and English plus Japanese otherwise, one "Pactlab:" prefix', async () => {
    const { lineMessage, CHANNEL_PREFIX: prefix } = await import('./index');
    const ja = lineMessage('ACT_NOW', { link, locale: 'ja' });
    expect(ja).toBe(`${prefix} 対応が必要なパクトがあります。Pactlabを開いてご確認ください: ${link}`);
    const both = lineMessage('ACT_NOW', { link });
    expect(both.startsWith(`${prefix} A pact needs you.`)).toBe(true);
    expect(both).toContain('対応が必要なパクトがあります');
    expect(both.split(prefix).length - 1).toBe(1);
  });

  it('has every message kind in both languages, content-free', async () => {
    const { lineMessage } = await import('./index');
    for (const kind of ['ACT_NOW', 'TEST', 'LINKED', 'LINK_EXPIRED', 'DISCONNECTED', 'STOPPED', 'LINE_LINKED', 'LINE_CONNECT_FROM_PROFILE'] as const) {
      const text = lineMessage(kind, { link });
      expect(text.startsWith('Pactlab:')).toBe(true);
      expect(text).not.toMatch(/\{link\}/);
    }
  });

  it('masks a LINE user id', () => {
    expect(maskContact('LINE', `U${'0'.repeat(30)}7f`)).toBe('LINE ••7f');
  });
});
