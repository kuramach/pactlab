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

describe('What’s new, in the guided tour’s panel (Kumar, 2026-11-25)', () => {
  it('shows one card with “What’s new · 1 of 3”, its link, and Back, Next and dismiss inside the panel', () => {
    const html = renderToStaticMarkup(<FeatureCardRail cards={[card('a'), card('b', { where: 'QUEUED' }), card('c', { where: 'QUEUED', icon: 'shield' })]} />);
    expect(html).toContain('aria-label="What’s new"');
    expect(html).toContain('What’s new · 1 of 3');
    expect(html).toContain('Title a');
    expect(html).not.toContain('Title b');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('>Back<');
    expect(html).toContain('>Next<');
    expect(html).toContain('aria-label="Dismiss: Title a"');
    expect(html).toContain('name="cardId" value="a"');
    // The tour's panel, not a look-alike.
    expect(html).toContain('border-indigo/30 bg-indigo/5');
  });

  it('one card: no Back or Next', () => {
    const html = renderToStaticMarkup(<FeatureCardRail cards={[card('a')]} />);
    expect(html).toContain('Title a');
    expect(html).not.toContain('>Next<');
  });

  it('renders nothing with no cards', () => {
    expect(renderToStaticMarkup(<FeatureCardRail cards={[]} />)).toBe('');
  });

  it('stops at either end, as the tour does', () => {
    expect(step(0, -1, 3)).toBe(0);
    expect(step(2, 1, 3)).toBe(2);
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
