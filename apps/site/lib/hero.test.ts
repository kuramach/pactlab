import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_ASSETS } from './hero';
import { ANNOUNCEMENT, HOME, POSITIONING, TAGLINE } from './content';

const file = (path: string) => readFileSync(new URL(`../public${path}`, import.meta.url));

describe('home hero video (T-130)', () => {
  it('ships the approved assets byte for byte: no re-encode, and phones get the small file', () => {
    for (const asset of Object.values(HERO_ASSETS)) {
      const bytes = file(asset.path);
      expect(bytes.length, asset.path).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.path).toBe(asset.sha256);
    }
    expect(HERO_ASSETS.mobile.bytes).toBeLessThan(HERO_ASSETS.desktop.bytes / 2);
  });

  it('keeps the live hero copy over the video, word for word', () => {
    expect(ANNOUNCEMENT).toEqual({ text: 'Now onboarding design partners for live deals.', link: { href: '/pilot', label: 'Request a pilot' } });
    expect(HOME.eyebrow).toBe('Deal management and execution for private equity and corporate development');
    expect(POSITIONING).toBe('The deal platform for private equity and corporate development: manage and execute acquisitions end to end, with diligence, valuation, terms and closing in one place.');
    expect(TAGLINE).toBe('AI rigor. Human judgment.');
  });
});
