import { describe, expect, it } from 'vitest';
import { CHANNEL_PREFIX, channelMessage, countryCodeLength, isStopWord, lineMessage, maskContact, normalizeEmail, toE164, type ChannelMessageKind } from './index';

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
    expect(maskContact('LINE', 'U0123456789abcdef0123456789abcdef')).toBe('LINE ••ef');
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

  it('LINE (T-182): Japanese for ja readers, English and Japanese together when the language is unknown', () => {
    const link = 'https://app.pactlab.ai/notifications';
    expect(lineMessage('ACT_NOW', { link, locale: 'ja' })).toBe(`Pactlab: 対応が必要なパクトがあります。Pactlabを開いてご確認ください：${link}`);
    expect(lineMessage('ACT_NOW', { link, locale: 'ja-JP' })).toBe(lineMessage('ACT_NOW', { link, locale: 'ja' }));
    expect(lineMessage('ACT_NOW', { link, locale: 'en' })).toBe(channelMessage('ACT_NOW', { link }));
    expect(lineMessage('ACT_NOW', { link })).toBe(`Pactlab: A pact needs you. Open Pactlab to see what\n対応が必要なパクトがあります。Pactlabを開いてご確認ください\n${link}`);
    const kinds: ChannelMessageKind[] = ['ACT_NOW', 'TEST', 'LINE_LINKED'];
    for (const kind of kinds) {
      for (const locale of ['ja', 'en', null]) {
        const text = lineMessage(kind, { link, locale });
        expect(text.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
        // The link appears at most once, and nothing is left of the placeholder.
        expect(text.split(link).length).toBeLessThanOrEqual(2);
        expect(text).not.toContain('{link}');
      }
    }
  });
});
