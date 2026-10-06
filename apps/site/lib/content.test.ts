import { describe, expect, it } from 'vitest';
import { siteConfig } from './config';
import * as content from './content';

const allCopy = JSON.stringify(content).toLowerCase();

describe('brand voice', () => {
  it('uses the brand tagline and pillar', () => {
    expect(content.TAGLINE).toBe('Test the pact before you sign it.');
    expect(content.PILLAR).toBe('AI diligence. Human instinct.');
  });

  it('never uses banned pitch-deck words', () => {
    const copy = JSON.stringify({ ...content, BANNED_WORDS: [] }).toLowerCase();
    for (const word of content.BANNED_WORDS) expect(copy).not.toContain(word);
  });

  it('makes no claims the product cannot back', () => {
    for (const claim of ['trusted by', 'our customers', '% faster', 'guarantee', 'certified']) {
      expect(allCopy).not.toContain(claim);
    }
  });
});

describe('siteConfig', () => {
  it('hides calls to action that are not configured', () => {
    expect(siteConfig({})).toEqual({ signInUrl: null, contactHref: null });
    expect(siteConfig({ NEXT_PUBLIC_APP_URL: ' ', NEXT_PUBLIC_CONTACT_EMAIL: '' })).toEqual({ signInUrl: null, contactHref: null });
  });

  it('builds sign-in and mailto links when configured', () => {
    expect(siteConfig({ NEXT_PUBLIC_APP_URL: 'https://app.example.test', NEXT_PUBLIC_CONTACT_EMAIL: 'pilots@example.test' })).toEqual({
      signInUrl: 'https://app.example.test/login',
      contactHref: 'mailto:pilots@example.test?subject=Pactlab%20pilot',
    });
  });

  it('rejects malformed values instead of shipping them', () => {
    expect(() => siteConfig({ NEXT_PUBLIC_CONTACT_EMAIL: 'not-an-email' })).toThrow();
  });
});
