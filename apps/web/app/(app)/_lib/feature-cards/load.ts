import { cache } from 'react';
import { apiGet } from '../../deals/_lib/api';
import type { FeatureCardsView } from './types';

/** The signed-in person's cards, once per request (the shell and the home share it). Null when unavailable: the cards are never worth an error page. */
export const loadFeatureCards = cache(async (): Promise<FeatureCardsView | null> => {
  const result = await apiGet<FeatureCardsView>('/v1/feature-cards');
  return result.kind === 'ok' ? result.data : null;
});
