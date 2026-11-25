'use client';

import { Button, buttonVariants, StepPanel } from '@pactlab/ui';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type KeyboardEvent, type TouchEvent } from 'react';
import { dismissFeatureCard } from './actions';
import { CardIcon } from './card-icon';
import type { FeatureCardView } from './types';

/** The position after a step back or forward, held at either end (as the guided tour is). */
export const step = (index: number, by: number, length: number) => (length === 0 ? 0 : Math.min(length - 1, Math.max(0, index + by)));

/**
 * What's new, one card at a time, in the guided tour's panel (Kumar, 2026-11-25: "Keep the Tour carousel design as
 * the winner"): "What's new · 2 of 5", the card, and Back, Next and dismiss inside the panel. The same on the home
 * and behind the icon. Arrow keys and a swipe move too.
 */
export function FeatureCardStepper({ cards, dismissible, onFollow }: { cards: readonly FeatureCardView[]; dismissible: boolean; onFollow?: () => void }) {
  const [at, setAt] = useState(0);
  const touch = useRef<number | null>(null);
  if (cards.length === 0) return null;
  const index = Math.min(at, cards.length - 1);
  const card = cards[index];
  if (!card) return null;
  const go = (by: number) => setAt(step(index, by, cards.length));
  const several = cards.length > 1;

  const onKeyDown = (event: KeyboardEvent) => {
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
    <StepPanel
      label="What’s new"
      icon={<CardIcon name={card.icon} />}
      eyebrow={several ? `What’s new · ${index + 1} of ${cards.length}` : 'What’s new'}
      title={card.title}
      onKeyDown={onKeyDown}
      onTouchStart={(event) => {
        touch.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={onTouchEnd}
      actions={
        <>
          {several ? (
            <>
              <Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => go(-1)}>
                Back
              </Button>
              <Button type="button" size="sm" disabled={index === cards.length - 1} onClick={() => go(1)}>
                Next
              </Button>
            </>
          ) : null}
          {dismissible ? (
            <form action={dismissFeatureCard}>
              <input type="hidden" name="cardId" value={card.id} />
              <Button type="submit" size="sm" variant="ghost" aria-label={`Dismiss: ${card.title}`} title="Dismiss. You can find it again behind the What’s new icon.">
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </form>
          ) : null}
        </>
      }
    >
      <p className="text-slate-text">{card.body}</p>
      {card.href ? (
        <Link href={card.href} onClick={onFollow} className={`${buttonVariants({ size: 'sm', variant: 'outline' })} mt-1 w-fit bg-card`}>
          {card.linkLabel ?? 'Learn more'}
        </Link>
      ) : null}
    </StepPanel>
  );
}
