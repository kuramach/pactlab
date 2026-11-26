/** GET /v1/deals/:dealId/market-rents (T-158). */
export interface MarketRentsStatus {
  available: boolean;
  source: string | null;
  address: string | null;
  addressFrom: 'PACT' | 'LISTING' | null;
  currencySupported: boolean;
  floorPlans: {
    key: string;
    label: string;
    units: number;
    occupied: number;
    medianSquareFeet: string | null;
    overCap: boolean;
    estimate: { evidenceId: string; rent: string; rentRangeLow: string; rentRangeHigh: string; currency: string; comparablesCount: number; retrievedOn: string; source: string; address: string } | null;
  }[];
  unplannedUnits: number;
  callsPerRetrieval: number;
}

/** What a screen needs to offer the check: whether it can run, and whether the address must be asked first. */
export interface MarketRentsOffer {
  /** Null when the check can run; otherwise why not, in plain words. */
  blocked: string | null;
  needsAddress: boolean;
  address: string | null;
  retrievedOn: string | null;
}

/** The offer from the status (null status: the role cannot see it, so nothing is offered). */
export function marketRentsOffer(status: MarketRentsStatus): MarketRentsOffer {
  const dates = status.floorPlans.flatMap((plan) => (plan.estimate ? [plan.estimate.retrievedOn] : [])).sort();
  return {
    blocked: !status.available
      ? 'Market rents are not set up in this environment.'
      : !status.currencySupported
        ? 'RentCast covers US properties: market rents are checked for pacts in USD only.'
        : status.floorPlans.length === 0
          ? 'Import the rent roll to check its rents against the market.'
          : null,
    needsAddress: status.address === null,
    address: status.address,
    retrievedOn: dates.at(-1) ?? null,
  };
}
