import { getI18n } from '../../../../lib/i18n/server';
import { FeatureCardStepper, type FeatureCardCopy } from './carousel';
import { loadFeatureCards } from './load';
import type { FeatureCardView } from './types';

/** The home's What's new: one card at a time in the tour's panel (Kumar, 2026-11-25), dismissible. */
export function FeatureCardRail({ cards, copy }: { cards: readonly FeatureCardView[]; copy: FeatureCardCopy }) {
  return <FeatureCardStepper cards={cards} dismissible copy={copy} />;
}

/** Every undismissed card, newest first: those on the home, then those waiting behind the icon. */
export async function HomeFeatureCards() {
  const view = await loadFeatureCards();
  if (!view) return null;
  const { m } = await getI18n();
  return <FeatureCardRail copy={m.notices.featureCards} cards={[...view.home, ...view.tray.filter((card) => card.where === 'QUEUED')]} />;
}
