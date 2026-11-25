import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ dismissFeatureCard: vi.fn(), markFeatureCardsRead: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as never}</a> }));

import { step } from './carousel';
import { FeatureCardRail } from './home-cards';
import { badgeCount, FeatureCardTray, FeatureCardTrayMount } from './tray';
import type { FeatureCardView } from './types';

const card = (id: string, over: Partial<FeatureCardView> = {}): FeatureCardView => ({
  id,
  version: 1,
  title: `Title ${id}`,
  body: `Body ${id}`,
  href: '/settings',
  linkLabel: 'Open Settings',
  icon: 'palette',
  where: 'HOME',
  unread: false,
  ...over,
});

describe('the home carousel (Kumar, 2026-11-25)', () => {
  it('shows the first card with its dismiss control and link, and arrows and dots to move to the others', () => {
    const html = renderToStaticMarkup(<FeatureCardRail cards={[card('a'), card('b', { where: 'QUEUED' }), card('c', { where: 'QUEUED', icon: 'cloud' })]} />);
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('Title a');
    expect(html).toContain('aria-label="Dismiss: Title a"');
    expect(html).toContain('name="cardId" value="a"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('1 of 3');
    expect(html).toContain('aria-label="Previous card"');
    expect(html).toContain('aria-label="Next card"');
    expect(html).toContain('aria-label="Show card 3: Title c"');
    // Each card its own colour.
    expect(html).toContain('from-indigo/15');
    expect(html).toContain('from-teal/15');
    expect(html).toContain('from-amber/15');
  });

  it('one card needs no arrows', () => {
    const html = renderToStaticMarkup(<FeatureCardRail cards={[card('a')]} />);
    expect(html).toContain('Title a');
    expect(html).not.toContain('Next card');
  });

  it('renders nothing with no cards', () => {
    expect(renderToStaticMarkup(<FeatureCardRail cards={[]} />)).toBe('');
  });

  it('moves round at either end', () => {
    expect(step(0, -1, 3)).toBe(2);
    expect(step(2, 1, 3)).toBe(0);
    expect(step(1, 1, 3)).toBe(2);
    expect(step(0, 1, 0)).toBe(0);
  });
});

describe('the icon beside the bug icon', () => {
  it('counts unread cards, and nothing once opened', () => {
    const cards = [card('a', { where: 'DISMISSED', unread: true }), card('b', { where: 'QUEUED', unread: true }), card('c', { where: 'DISMISSED' })];
    expect(badgeCount(cards, false)).toBe(2);
    expect(badgeCount(cards, true)).toBe(0);
  });

  it('shows the badge count in its name, and no badge when everything is read', () => {
    const unread = renderToStaticMarkup(<FeatureCardTray cards={[card('a', { where: 'DISMISSED', unread: true })]} />);
    expect(unread).toContain('What’s new, 1 unread');
    expect(unread).toContain('feature-card-badge');
    const read = renderToStaticMarkup(<FeatureCardTray cards={[card('a', { where: 'DISMISSED' })]} />);
    expect(read).toContain('aria-label="What’s new"');
    expect(read).not.toContain('feature-card-badge');
  });

  it('sits left of the bug icon without taking its place, and only exists with cards in it', () => {
    expect(renderToStaticMarkup(<FeatureCardTray cards={[card('a', { where: 'DISMISSED' })]} />)).toContain('right-[4.5rem]');
    expect(renderToStaticMarkup(<FeatureCardTrayMount cards={null} />)).toBe('');
    expect(renderToStaticMarkup(<FeatureCardTrayMount cards={[]} />)).toBe('');
  });
});
