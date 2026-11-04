import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { askingLabel, grouped, Teaser, teaserTitle } from './teaser';

const listing = {
  visibility: 'ANONYMOUS' as const,
  codename: 'Project Atlas',
  publicName: null,
  headline: 'Profitable workflow SaaS',
  sector: 'Software & SaaS',
  region: 'North America',
  sizeBand: 'USD 5–10M ARR',
  asking: { low: '40000000.00', high: '55000000', currency: 'USD' },
  summary: 'Synthetic teaser.',
  highlights: ['Founder-led'],
};

describe('public teaser', () => {
  it('shows only the codename when anonymous, and the name when the seller chose Named', () => {
    expect(teaserTitle(listing)).toBe('Project Atlas');
    // A name stored on an anonymous page is never shown.
    expect(teaserTitle({ ...listing, publicName: 'Brightwave Software' })).toBe('Project Atlas');
    expect(teaserTitle({ ...listing, visibility: 'NAMED', publicName: 'Brightwave Software' })).toBe('Brightwave Software');
    const html = renderToStaticMarkup(<Teaser listing={{ ...listing, publicName: 'Brightwave Software' }} />);
    expect(html).toContain('Project Atlas');
    expect(html).toContain('Confidential sale');
    expect(html).not.toContain('Brightwave');
  });

  it('formats the asking range from decimal strings', () => {
    expect(grouped('40000000.00')).toBe('40,000,000');
    expect(grouped('1234.50')).toBe('1,234.50');
    expect(askingLabel(listing.asking)).toBe('USD 40,000,000 – 55,000,000');
    expect(askingLabel({ low: '9000000', high: null, currency: 'GBP' })).toBe('From GBP 9,000,000');
    expect(askingLabel(null)).toBeNull();
  });
});
