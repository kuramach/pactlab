import { Button, buttonVariants, IconTile } from '@pactlab/ui';
import { X } from 'lucide-react';
import Link from 'next/link';
import { dismissFeatureCard } from './actions';
import { CardIcon } from './card-icon';
import { loadFeatureCards } from './load';
import type { FeatureCardView } from './types';

export function FeatureCardRail({ cards, queued }: { cards: readonly FeatureCardView[]; queued: number }) {
  if (cards.length === 0) return null;
  return (
    <section aria-label="What’s new" className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((card) => (
          <article key={card.id} aria-label={card.title} className="relative flex gap-3 rounded-xl border border-border bg-card p-4 pr-12 text-sm shadow-sm">
            <IconTile accent="indigo">
              <CardIcon name={card.icon} />
            </IconTile>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-ink">New</p>
              <h2 className="text-base font-semibold leading-snug">{card.title}</h2>
              <p className="text-muted-foreground">{card.body}</p>
              {card.href ? (
                <Link href={card.href} className={`${buttonVariants({ size: 'sm', variant: 'outline' })} w-fit`}>
                  {card.linkLabel ?? 'Learn more'}
                </Link>
              ) : null}
            </div>
            <form action={dismissFeatureCard} className="absolute right-2 top-2">
              <input type="hidden" name="cardId" value={card.id} />
              <Button type="submit" size="sm" variant="ghost" aria-label={`Dismiss: ${card.title}`} title="Dismiss. You can find it again by the bug icon.">
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </form>
          </article>
        ))}
      </div>
      {queued > 0 ? <p className="text-xs text-muted-foreground">{queued} more {queued === 1 ? 'card is' : 'cards are'} waiting behind the What’s new icon by the bug icon.</p> : null}
    </section>
  );
}

/** At most two undismissed cards on the home, newest first; the rest wait behind the icon with a count. */
export async function HomeFeatureCards() {
  const view = await loadFeatureCards();
  if (!view) return null;
  return <FeatureCardRail cards={view.home} queued={view.tray.filter((card) => card.where === 'QUEUED').length} />;
}
