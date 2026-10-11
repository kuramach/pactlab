/**
 * Market comparables from a licensed data provider (precedent transactions
 * and public-peer multiples). Port only: no provider is chosen or licensed
 * yet, and adding a paid provider needs the founder's approval. Rows a
 * provider returns are stored with origin PROVIDER, the provider's name and
 * its data version, so every benchmark says where its numbers came from.
 */
export interface ProviderComparable {
  readonly providerRecordId: string;
  readonly kind: 'PRECEDENT_TRANSACTION' | 'PUBLIC_PEER';
  readonly name: string;
  readonly targetName: string;
  readonly acquirerName: string | null;
  readonly announcedOn: string | null;
  readonly companyType: string;
  readonly region: string | null;
  /** Decimal strings in `currency`. */
  readonly enterpriseValue: string;
  readonly arr: string;
  readonly currency: string;
  readonly arrGrowth: string | null;
  readonly nrr: string | null;
  readonly grr: string | null;
  readonly sourceUrl: string | null;
}

export interface ComparablesQuery {
  readonly companyType: string;
  readonly since: string | null;
  readonly limit: number;
}

export type ComparablesProviderResult =
  | { readonly status: 'OK'; readonly provider: string; readonly dataVersion: string; readonly items: readonly ProviderComparable[] }
  | { readonly status: 'NOT_CONFIGURED' };

export interface ComparablesProvider {
  search(query: ComparablesQuery): Promise<ComparablesProviderResult>;
}

/** The only implementation until a provider is approved: it reports that none is configured. */
export class NotConfiguredComparablesProvider implements ComparablesProvider {
  search(): Promise<ComparablesProviderResult> {
    return Promise.resolve({ status: 'NOT_CONFIGURED' });
  }
}
