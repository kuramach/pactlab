import { FeatureCardStepper } from './carousel';
import { loadFeatureCards } from './load';
import type { FeatureCardView } from './types';

/** The home's What's new: one card at a time in the tour's panel (Kumar, 2026-11-25), dismissible. */
export function FeatureCardRail({ cards }: { cards: readonly FeatureCardView[] }) {
  return <FeatureCardStepper cards={cards} dismissible />;
}

/** Every undismissed card, newest first: those on the home, then those waiting behind the icon. */
export async function HomeFeatureCards() {
  const view = await loadFeatureCards();
  if (!view) return null;
  return <FeatureCardRail cards={[...view.home, ...view.tray.filter((card) => card.where === 'QUEUED')]} />;
}
