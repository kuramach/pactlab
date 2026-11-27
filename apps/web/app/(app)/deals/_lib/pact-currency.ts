import { dealsApi } from './api';

/**
 * The pact's own currency (T-170): what a new amount on the pact is entered in, so a form never assumes dollars.
 * Falls back to USD only when the pact cannot be read (the page then shows the API's own state).
 */
export async function pactCurrency(dealId: string): Promise<string> {
  const deal = await dealsApi.get(dealId);
  return deal.kind === 'ok' ? (deal.data.baseCurrency ?? 'USD') : 'USD';
}
