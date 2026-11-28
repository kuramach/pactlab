import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_EVENTS } from '@pactlab/domain';
import { digestEmail, immediateEmail } from '../notifications/notification-emails';
import { emailAssets, escapeHtml, renderEmailHtml } from './branded-email';
import { EMAIL_COPY, EMAIL_LOCALES, resolveEmailLocale, type EmailLocale } from './email-catalog';
import type { OutboundEmail } from './email-sender';
import { emails } from './emails';

const assets = emailAssets('https://app.pactlab.ai');
const origin = 'https://app.pactlab.ai';
const pact = 'Project Sakura';
const item = { type: 'TERMS_PROPOSED' as const, dealName: pact, link: '/deals/0190d1b2-0000-7000-8000-000000000001/terms' };

/** The five highest-volume emails (T-174 checks), in one language. */
const fiveEmails = (locale: EmailLocale): OutboundEmail[] => [
  emails.signInCode('a@example.com', '123456', 10, locale),
  emails.signupCode('a@example.com', '654321', 10, locale),
  emails.dealInvitation('a@example.com', { inviterName: 'Ann', dealName: pact, side: 'SELLER', role: 'TARGET_CONTRIBUTOR', link: 'https://app.pactlab.ai/invite/t', days: 14 }, locale),
  immediateEmail('a@example.com', item, origin, locale),
  digestEmail('a@example.com', [item, { ...item, type: 'FINDING_DRAFTED' }], origin, locale),
];

/** Every English chrome string that must not survive into another language's email. */
const englishChrome = [
  EMAIL_COPY.en.layout.tagline,
  EMAIL_COPY.en.layout.blurb,
  EMAIL_COPY.en.layout.learnMore,
  EMAIL_COPY.en.layout.pasteLink,
  EMAIL_COPY.en.layout.defaultReason,
  'Sent with Pactlab',
  EMAIL_COPY.en.signInCode.heading,
  EMAIL_COPY.en.invitation.open,
  EMAIL_COPY.en.notification.open,
  EMAIL_COPY.en.digest.heading,
  EMAIL_COPY.en.notification.titles.TERMS_PROPOSED,
];

describe('emails in the recipient’s language (T-174)', () => {
  it('reads the first offered language, a region counting as its language, else English', () => {
    expect(resolveEmailLocale(null, 'ja-JP', 'de')).toBe('ja');
    expect(resolveEmailLocale('pt-BR', 'de_AT')).toBe('de');
    expect(resolveEmailLocale(undefined, '')).toBe('en');
    expect(resolveEmailLocale('zz')).toBe('en');
  });

  it('English notification titles are the catalogue’s, word for word', () => {
    for (const type of NOTIFICATION_EVENT_TYPES) expect(EMAIL_COPY.en.notification.titles[type]).toBe(NOTIFICATION_EVENTS[type].title);
  });

  it('no language leaves a string empty or falls back to English', () => {
    for (const locale of EMAIL_LOCALES) {
      const titles = Object.values(EMAIL_COPY[locale].notification.titles);
      expect(titles.every((title) => title.trim().length > 0), locale).toBe(true);
      if (locale === 'en') continue;
      for (const [type, title] of Object.entries(EMAIL_COPY[locale].notification.titles)) expect(title, `${locale} ${type}`).not.toBe(EMAIL_COPY.en.notification.titles[type as keyof typeof EMAIL_COPY.en.notification.titles]);
    }
  });

  describe.each(EMAIL_LOCALES)('%s', (locale) => {
    it('keeps the branded layout: the header logo, the translated footer tagline and note, the sender name', () => {
      for (const message of fiveEmails(locale)) {
        expect(message.locale, message.subject).toBe(locale);
        const html = renderEmailHtml(message.subject, message.content!, assets, undefined, locale);
        expect(html).toContain(`<html lang="${locale}">`);
        expect(html).toContain('src="https://pactlab.ai/brand/pactlab-logo-email.png"');
        expect(html).toContain('alt="Pactlab"');
        expect(html).toContain(EMAIL_COPY[locale].layout.tagline);
        expect(html).toContain(escapeHtml(EMAIL_COPY[locale].layout.blurb));
        if (message.content?.code) expect(message.text).toContain(message.content.code);
        if (message.content?.action) expect(message.text).toContain(message.content.action.url);
      }
    });

    it('with an organization brand kit, the “Sent with Pactlab for …” line is translated too', () => {
      const message = emails.dealInvitation('a@example.com', { inviterName: 'Ann', dealName: pact, side: 'BUYER', role: 'ANALYST', link: 'https://app.pactlab.ai/invite/t', days: 14 }, locale);
      const html = renderEmailHtml(message.subject, message.content!, assets, { name: 'Acme Capital', logoUrl: null, accentColor: '#336699' }, locale);
      expect(html).toContain(EMAIL_COPY[locale].layout.sentFor('Acme Capital'));
      expect(html).toContain(EMAIL_COPY[locale].layout.tagline);
    });

    it.skipIf(locale === 'en')('carries no English chrome', () => {
      for (const message of fiveEmails(locale)) {
        const html = renderEmailHtml(message.subject, message.content!, assets, undefined, locale);
        for (const english of englishChrome) {
          expect(html, `${message.subject}: ${english}`).not.toContain(english);
          expect(message.text, `${message.subject}: ${english}`).not.toContain(english);
        }
      }
    });
  });

  it('a Japanese reader gets sign-in, notification and digest emails fully in Japanese', () => {
    const [signIn, , , notification, digest] = fiveEmails('ja');
    expect(signIn?.subject).toBe('Pactlabのサインインコード');
    expect(notification?.subject).toBe(`新しい条件があなたの回答を待っています — ${pact}`);
    expect(digest?.subject).toBe('Pactlabダイジェスト：更新2件');
    expect(digest?.content?.list?.items).toEqual([`${pact}: 新しい条件があなたの回答を待っています`, `${pact}: 指摘事項が起案されました`]);
  });

  it('English is unchanged when no language is given', () => {
    const message = emails.signInCode('a@example.com', '123456', 10);
    expect(message.text).toBe(['Your Pactlab sign-in code is 123456.', 'It expires in 10 minutes and works once.', 'If you did not try to sign in, ignore this email.'].join('\n'));
    expect(renderEmailHtml(message.subject, message.content!, assets)).toContain('<html lang="en">');
  });
});
