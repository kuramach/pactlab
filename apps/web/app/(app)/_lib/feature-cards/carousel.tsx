'use client';

import { Button, buttonVariants, cn, IconTile, type Accent } from '@pactlab/ui';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type KeyboardEvent, type TouchEvent } from 'react';
import { dismissFeatureCard } from './actions';
import { CardIcon } from './card-icon';
import type { FeatureCardView } from './types';

/** Each card its own colour, in turn, so one is never mistaken for the next. */
const THEMES: readonly { accent: Accent; card: string; label: string }[] = [
  { accent: 'indigo', card: 'border-indigo/30 bg-gradient-to-br from-indigo/15 via-card to-card', label: 'text-indigo-ink' },
  { accent: 'teal', card: 'border-teal/30 bg-gradient-to-br from-teal/15 via-card to-card', label: 'text-teal' },
  { accent: 'amber', card: 'border-amber/35 bg-gradient-to-br from-amber/15 via-card to-card', label: 'text-amber' },
  { accent: 'rose', card: 'border-rose/30 bg-gradient-to-br from-rose/15 via-card to-card', label: 'text-rose' },
];
const FIRST = { accent: 'indigo', card: 'border-indigo/30 bg-gradient-to-br from-indigo/15 via-card to-card', label: 'text-indigo-ink' } as const;
export const themeOf = (index: number) => THEMES[index % THEMES.length] ?? FIRST;

/** The next position, wrapping round at either end. */
export const step = (index: number, by: number, length: number) => (length === 0 ? 0 : (((index + by) % length) + length) % length);

/**
 * What's new on the home (Kumar, 2026-11-25: "a carousel and it can be moved left and right … nice and elegant with
 * good color separation"): one card at a time, moved with the arrows, the dots, the arrow keys or a swipe.
 */
export function FeatureCardCarousel({ cards }: { cards: readonly FeatureCardView[] }) {
  const [at, setAt] = useState(0);
  const touch = useRef<number | null>(null);
  if (cards.length === 0) return null;
  const index = Math.min(at, cards.length - 1);
  const go = (by: number) => setAt(step(index, by, cards.length));
  const several = cards.length > 1;

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') go(-1);
    if (event.key === 'ArrowRight') go(1);
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const end = event.changedTouches[0]?.clientX;
    if (start === null || end === undefined || Math.abs(end - start) < 40) return;
    go(end < start ? 1 : -1);
  };

  return (
    <section aria-label="What’s new" aria-roledescription="carousel" className="flex flex-col gap-3" onKeyDown={onKey}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">What’s new</h2>
        {several ? (
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {index + 1} of {cards.length}
            </span>
            <Button size="sm" variant="outline" className="h-8 w-8 rounded-full p-0" aria-label="Previous card" onClick={() => go(-1)}>
              <ChevronLeft aria-hidden className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="h-8 w-8 rounded-full p-0" aria-label="Next card" onClick={() => go(1)}>
              <ChevronRight aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>
      <div
        className="overflow-hidden rounded-2xl"
        onTouchStart={(event) => {
          touch.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${index * 100}%)` }}>
          {cards.map((card, position) => {
            const theme = themeOf(position);
            const shown = position === index;
            return (
              <article
                key={card.id}
                aria-roledescription="slide"
                aria-label={`${position + 1} of ${cards.length}: ${card.title}`}
                aria-hidden={!shown}
                inert={!shown}
                className={cn('relative flex w-full shrink-0 gap-4 rounded-2xl border p-5 pr-12 text-sm shadow-sm', theme.card)}
              >
                <IconTile accent={theme.accent}>
                  <CardIcon name={card.icon} />
                </IconTile>
                <div className="flex min-w-0 flex-col gap-2">
                  <p className={cn('text-xs font-semibold uppercase tracking-wide', theme.label)}>New</p>
                  <h3 className="text-base font-semibold leading-snug">{card.title}</h3>
                  <p className="max-w-prose text-muted-foreground">{card.body}</p>
                  {card.href ? (
                    <Link href={card.href} className={`${buttonVariants({ size: 'sm', variant: 'outline' })} w-fit bg-card`}>
                      {card.linkLabel ?? 'Learn more'}
                    </Link>
                  ) : null}
                </div>
                <form action={dismissFeatureCard} className="absolute right-2 top-2">
                  <input type="hidden" name="cardId" value={card.id} />
                  <Button type="submit" size="sm" variant="ghost" aria-label={`Dismiss: ${card.title}`} title="Dismiss. You can find it again behind the What’s new icon.">
                    <X aria-hidden className="h-4 w-4" />
                  </Button>
                </form>
              </article>
            );
          })}
        </div>
      </div>
      {several ? (
        <div className="flex justify-center gap-1.5" role="group" aria-label="Choose a card">
          {cards.map((card, position) => (
            <Button
              key={card.id}
              size="sm"
              variant="ghost"
              aria-label={`Show card ${position + 1}: ${card.title}`}
              aria-current={position === index}
              onClick={() => setAt(position)}
              className={cn('h-2 min-w-0 rounded-full p-0 transition-all', position === index ? 'w-6 bg-navy hover:bg-navy' : 'w-2 bg-border hover:bg-muted-foreground/40')}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
