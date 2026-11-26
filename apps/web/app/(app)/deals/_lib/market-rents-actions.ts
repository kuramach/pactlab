'use server';

import { z } from 'zod';
import { apiGet, apiSend } from './api';
import type { MarketRentsStatus } from './market-rents';

const uuid = z.uuid();
const address = z.string().trim().min(5).max(200);

/** Plain words for the API's codes; never provider text. */
const MESSAGES: Record<string, string> = {
  MARKET_RENTS_OFF: 'Market rents are not set up in this environment (no RentCast key).',
  MARKET_RENTS_USD_ONLY: 'RentCast covers US properties: market rents are checked for pacts in USD only.',
  PROPERTY_ADDRESS_NEEDED: 'Enter the property’s address first.',
  RENT_ROLL_NEEDED: 'Import the rent roll first: market rents are checked per floor plan.',
  NO_FLOOR_PLANS: 'The rent roll’s unit types name no bedroom counts (like 1BR or 2BR/1BA), so there is no floor plan to check.',
  MARKET_RENTS_RATE_LIMITED: 'RentCast is busy right now. Try again in a minute.',
  MARKET_RENTS_KEY_REFUSED: 'RentCast refused Pactlab’s key. An administrator needs to set it again.',
  MARKET_RENTS_UNAVAILABLE: 'RentCast did not answer. Try again later.',
};

export type MarketRentsOutcome = { kind: 'ok'; message: string } | { kind: 'error'; message: string };

/**
 * Check rents against the market (T-158): store the address if one was asked for, then retrieve one estimate per
 * floor plan. The API checks the role, caps the calls and makes a same-day re-run a no-op.
 */
export async function checkMarketRents(dealId: string, propertyAddress: string | null): Promise<MarketRentsOutcome> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown pact.' };
  if (propertyAddress !== null) {
    const parsed = address.safeParse(propertyAddress);
    if (!parsed.success) return { kind: 'error', message: 'Enter the full address: street, city, state and ZIP code.' };
    const saved = await apiSend('PUT', `/v1/deals/${dealId}/market-rents/address`, { address: parsed.data });
    if (saved.kind === 'forbidden') return { kind: 'error', message: 'Only the buyer team’s analysts and lead can check market rents.' };
    if (saved.kind !== 'ok') return { kind: 'error', message: 'The address was not saved. Try again.' };
  }
  const result = await apiSend<MarketRentsStatus & { retrieval: { calls: number; created: number; noEstimate: string[]; overCap: string[] } }>('POST', `/v1/deals/${dealId}/market-rents/retrieve`, {});
  if (result.kind === 'ok') {
    const { calls, created, noEstimate, overCap } = result.data.retrieval;
    const parts = [calls === 0 ? 'Market rents are already up to date today.' : `${created} floor plan estimate${created === 1 ? '' : 's'} added from ${result.data.source ?? 'RentCast'}.`];
    if (noEstimate.length) parts.push(`No estimate for ${noEstimate.join(', ')}.`);
    if (overCap.length) parts.push(`${overCap.length} smaller floor plan${overCap.length === 1 ? ' was' : 's were'} over the limit of ${result.data.callsPerRetrieval} and not checked.`);
    return { kind: 'ok', message: parts.join(' ') };
  }
  if (result.kind === 'forbidden') return { kind: 'error', message: 'Only the buyer team’s analysts and lead can check market rents.' };
  if ((result.kind === 'invalid' || result.kind === 'unavailable') && result.code && MESSAGES[result.code]) return { kind: 'error', message: MESSAGES[result.code] ?? '' };
  return { kind: 'error', message: 'Market rents could not be checked. Try again.' };
}

/** The pact's market-rents status, for a screen that offers the check. */
export async function marketRentsStatus(dealId: string) {
  return apiGet<MarketRentsStatus>(`/v1/deals/${encodeURIComponent(dealId)}/market-rents`);
}
