'use client';

import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { markFeatureCardsRead } from './actions';
import { FeatureCardStepper } from './carousel';
import type { FeatureCardView } from './types';

/** The badge: unread cards in the list, until it has been opened. */
export function badgeCount(cards: readonly FeatureCardView[], opened: boolean): number {
  return opened ? 0 : cards.filter((card) => card.unread).length;
}

/**
 * The "What's new" icon, fixed immediately left of the bug icon (which does not move). It holds the
 * cards dismissed from the home and those waiting behind it; opening it marks them read.
 */
export function FeatureCardTray({ cards }: { cards: readonly FeatureCardView[] }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const count = badgeCount(cards, opened);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  // New unread cards (a new version, another dismissal) show on the badge again.
  const unreadKey = cards.filter((card) => card.unread).map((card) => `${card.id}@${card.version}`).join(',');
  useEffect(() => setOpened(false), [unreadKey]);

  if (cards.length === 0) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !opened) {
      setOpened(true);
      if (cards.some((card) => card.unread)) void markFeatureCardsRead();
    }
  };

  return (
    <div ref={root}>
      <button
        type="button"
        aria-label={count > 0 ? `What’s new, ${count} unread` : 'What’s new'}
        aria-expanded={open}
        aria-controls="feature-card-list"
        title="What’s new"
        onClick={toggle}
        className="fixed bottom-4 right-[4.5rem] z-30 flex h-11 w-11 items-center justify-center rounded-full bg-navy text-white shadow-lg ring-1 ring-white/20 hover:bg-navy/90 focus:outline-none focus:ring-2 focus:ring-indigo"
      >
        <Sparkles aria-hidden className="h-5 w-5" />
        {count > 0 ? (
          <span aria-hidden data-testid="feature-card-badge" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo px-1 text-[11px] font-extrabold text-navy ring-2 ring-background">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id="feature-card-list" className="fixed bottom-20 right-4 z-40 w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-card shadow-xl">
          <FeatureCardStepper cards={cards} dismissible={false} onFollow={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/** The shell's mount: only for a signed-in person with something behind the icon. */
export function FeatureCardTrayMount({ cards }: { cards: readonly FeatureCardView[] | null }) {
  return cards && cards.length > 0 ? <FeatureCardTray cards={cards} /> : null;
}
