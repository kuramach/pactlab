'use client';

import { Button } from '@pactlab/ui';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { markFeatureCardsRead } from './actions';
import { step, themeOf } from './carousel';
import { CardIcon } from './card-icon';
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
  // One card at a time, paged with back and forward (Kumar, 2026-11-25).
  const [at, setAt] = useState(0);
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
  const index = Math.min(at, cards.length - 1);
  const card = cards[index];

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
        <section
          id="feature-card-list"
          aria-label="What’s new"
          className="fixed bottom-20 right-4 z-40 flex max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 text-sm shadow-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">What’s new</h2>
            {cards.length > 1 ? (
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                  {index + 1} of {cards.length}
                </span>
                <Button size="sm" variant="outline" className="h-8 w-8 rounded-full p-0" aria-label="Back" onClick={() => setAt(step(index, -1, cards.length))}>
                  <ChevronLeft aria-hidden className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" className="h-8 w-8 rounded-full p-0" aria-label="Forward" onClick={() => setAt(step(index, 1, cards.length))}>
                  <ChevronRight aria-hidden className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
          {card ? (
            <article aria-label={card.title} className={`flex gap-3 rounded-xl border p-4 ${themeOf(index).card}`}>
              <CardIcon name={card.icon} className={`mt-0.5 h-5 w-5 shrink-0 ${themeOf(index).label}`} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-semibold leading-snug">{card.title}</p>
                <p className="text-muted-foreground">{card.body}</p>
                {card.href ? (
                  <Link href={card.href} onClick={() => setOpen(false)} className="w-fit font-medium text-indigo-ink underline underline-offset-2">
                    {card.linkLabel ?? 'Learn more'}
                  </Link>
                ) : null}
              </div>
            </article>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** The shell's mount: only for a signed-in person with something behind the icon. */
export function FeatureCardTrayMount({ cards }: { cards: readonly FeatureCardView[] | null }) {
  return cards && cards.length > 0 ? <FeatureCardTray cards={cards} /> : null;
}
