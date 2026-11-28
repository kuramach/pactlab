import { describe, expect, it } from 'vitest';
import { digestEmail, emailLocaleOf } from './notification-emails';

describe('the language of a notification email (T-174b)', () => {
  const item = (workingLanguage: string | null) => ({ type: 'DOCUMENT_ADDED' as const, dealName: 'Kite', link: '/deals/x', workingLanguage });

  it('follows the pact working language, else English', () => {
    expect(emailLocaleOf([item('ja')])).toBe('ja');
    expect(emailLocaleOf([item(null)])).toBe('en');
    expect(emailLocaleOf([item('xx')])).toBe('en');
  });

  it('writes a digest across pacts in different languages in English, and in theirs when they agree', () => {
    expect(emailLocaleOf([item('de'), item('ja')])).toBe('en');
    expect(emailLocaleOf([item('de'), item('de')])).toBe('de');
    expect(digestEmail('a@example.com', [item('de'), item('de')], 'https://app.pactlab.ai', emailLocaleOf([item('de')])).locale).toBe('de');
  });

  it('puts the person and the organization ahead of the pact once they are stored (T-172b)', () => {
    expect(emailLocaleOf([item('ja')], 'fr')).toBe('fr');
    expect(emailLocaleOf([item('ja')], null, 'de')).toBe('de');
  });
});
