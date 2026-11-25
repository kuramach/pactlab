import { describe, expect, it } from 'vitest';
import { arrangeFeatureCards, FEATURE_CARD_ICONS, FEATURE_CARDS, HOME_CARD_LIMIT, type FeatureCardDefinition, type FeatureCardState } from './feature-cards';

const card = (id: string, addedOn: string, version = 1): FeatureCardDefinition => ({ id, version, addedOn, title: id, body: `${id} body`, href: null, icon: 'table' });
const A = card('a-oldest', '2026-01-01');
const B = card('b-middle', '2026-02-01');
const C = card('c-newest', '2026-03-01');
const states = (entries: Record<string, Partial<FeatureCardState>>) =>
  new Map(Object.entries(entries).map(([id, state]) => [id, { dismissedVersion: 0, readVersion: 0, ...state }]));
const ids = (list: { id: string }[]) => list.map((entry) => entry.id);

describe('the feature-card registry', () => {
  it('holds valid, unique, app-relative cards', () => {
    expect(new Set(FEATURE_CARDS.map((entry) => entry.id)).size).toBe(FEATURE_CARDS.length);
    for (const entry of FEATURE_CARDS) {
      expect(entry.id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      expect(entry.version).toBeGreaterThanOrEqual(1);
      expect(entry.addedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(FEATURE_CARD_ICONS).toContain(entry.icon);
      if (entry.href) expect(entry.href).toMatch(/^\/(?!\/)/);
    }
  });
});

describe('arranging a person’s feature cards', () => {
  it('shows at most two undismissed cards on the home, newest first, and queues the rest', () => {
    const view = arrangeFeatureCards([A, B, C], new Map());
    expect(HOME_CARD_LIMIT).toBe(2);
    expect(ids(view.home)).toEqual(['c-newest', 'b-middle']);
    expect(view.tray.map((entry) => [entry.id, entry.where])).toEqual([['a-oldest', 'QUEUED']]);
    expect(view.unread).toBe(1);
  });

  it('moves a dismissed card to the tray and brings the next queued card up', () => {
    const view = arrangeFeatureCards([A, B, C], states({ 'c-newest': { dismissedVersion: 1 } }));
    expect(ids(view.home)).toEqual(['b-middle', 'a-oldest']);
    expect(view.tray.map((entry) => [entry.id, entry.where, entry.unread])).toEqual([['c-newest', 'DISMISSED', true]]);
    expect(view.unread).toBe(1);
  });

  it('clears the badge once the tray cards are read', () => {
    const view = arrangeFeatureCards([A, B, C], states({ 'c-newest': { dismissedVersion: 1, readVersion: 1 }, 'a-oldest': { readVersion: 1 } }));
    expect(view.unread).toBe(0);
    expect(view.tray.every((entry) => !entry.unread)).toBe(true);
  });

  it('puts a card with a new version back on the home, unread, even though an older version was dismissed', () => {
    const v2 = { ...C, version: 2 };
    const dismissedV1 = states({ 'c-newest': { dismissedVersion: 1, readVersion: 1 } });
    expect(ids(arrangeFeatureCards([A, B, C], dismissedV1).home)).not.toContain('c-newest');
    const view = arrangeFeatureCards([A, B, v2], dismissedV1);
    expect(ids(view.home)).toEqual(['c-newest', 'b-middle']);
    // Dismissed again at v2: it stays away, and is unread until read at v2.
    const again = arrangeFeatureCards([A, B, v2], states({ 'c-newest': { dismissedVersion: 2, readVersion: 1 } }));
    expect(again.home.map((entry) => entry.id)).not.toContain('c-newest');
    expect(again.tray.find((entry) => entry.id === 'c-newest')?.unread).toBe(true);
  });

  it('is empty, with no badge, when every card is dismissed and read', () => {
    const view = arrangeFeatureCards([A], states({ 'a-oldest': { dismissedVersion: 1, readVersion: 1 } }));
    expect(view.home).toEqual([]);
    expect(view.unread).toBe(0);
  });
});
