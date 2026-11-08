import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { askingLabel, embedUrl, grouped, Media, Teaser, teaserTitle } from './teaser';

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
  propertyAddress: '5500 Grand Lake Dr, San Antonio, TX 78244',
  propertyFacts: [{ key: 'units', label: 'Units', value: '48', source: 'RentCast', retrievedAt: '2026-11-07T00:00:00.000Z' }],
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

  it('shows the property facts with their source, and the address only on a named page (batch 2)', () => {
    const anonymous = renderToStaticMarkup(<Teaser listing={listing} />);
    expect(anonymous).toContain('Units');
    expect(anonymous).toContain('Source: RentCast');
    expect(anonymous).not.toContain('Grand Lake');
    expect(renderToStaticMarkup(<Teaser listing={{ ...listing, visibility: 'NAMED', publicName: 'Atlas Apartments' }} />)).toContain('5500 Grand Lake Dr');
  });

  it('formats the asking range from decimal strings', () => {
    expect(grouped('40000000.00')).toBe('40,000,000');
    expect(grouped('1234.50')).toBe('1,234.50');
    expect(askingLabel(listing.asking)).toBe('USD 40,000,000 – 55,000,000');
    expect(askingLabel({ low: '9000000', high: null, currency: 'GBP' })).toBe('From GBP 9,000,000');
    expect(askingLabel(null)).toBeNull();
  });
});

describe('pictures and video on the page', () => {
  const media = [
    { id: 'img-1', kind: 'IMAGE' as const, caption: 'Head office', videoProvider: null, videoId: null },
    { id: 'img-2', kind: 'IMAGE' as const, caption: null, videoProvider: null, videoId: null },
    { id: 'vid-1', kind: 'VIDEO' as const, caption: 'Product tour', videoProvider: 'YOUTUBE' as const, videoId: 'dQw4w9WgXcQ' },
    { id: 'vid-2', kind: 'VIDEO' as const, caption: null, videoProvider: 'VIMEO' as const, videoId: '76979871' },
  ];

  it('embeds only the providers\' privacy-enhanced players, for well-formed ids', () => {
    expect(embedUrl(media[2]!)).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(embedUrl(media[3]!)).toBe('https://player.vimeo.com/video/76979871?dnt=1');
    expect(embedUrl({ videoProvider: 'YOUTUBE', videoId: '"><script>' })).toBeNull();
    expect(embedUrl({ videoProvider: null, videoId: null })).toBeNull();
  });

  it('shows the first picture large, the rest as thumbnails, and sandboxed players', () => {
    const html = renderToStaticMarkup(<Media media={media} imageHref={(id) => `/listings/pl-abcdefghij/media/${id}`} />);
    expect(html).toContain('src="/listings/pl-abcdefghij/media/img-1"');
    expect(html).toContain('aria-label="More pictures"');
    expect(html).toContain('Head office');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(renderToStaticMarkup(<Media media={[]} imageHref={(id) => id} />)).toBe('');
  });
});

