import { FeatureCardCarousel } from './carousel';
import { loadFeatureCards } from './load';
import type { FeatureCardView } from './types';

/** The home's cards as a carousel (Kumar, 2026-11-25): those on the home first, then those waiting behind the icon. */
export function FeatureCardRail({ cards }: { cards: readonly FeatureCardView[] }) {
  return <FeatureCardCarousel cards={cards} />;
}

/** Every undismissed card, newest first, one at a time on the home. */
export async function HomeFeatureCards() {
  const view = await loadFeatureCards();
  if (!view) return null;
  return <FeatureCardRail cards={[...view.home, ...view.tray.filter((card) => card.where === 'QUEUED')]} />;
}
