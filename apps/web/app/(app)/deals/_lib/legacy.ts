import { isUuidParam } from './filters';

type Search = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Where an old `/findings?deal=…`-style address now lives inside its deal,
 * keeping any other query parameters. Without a valid deal: My deals.
 */
export function legacyDealPath(section: 'findings' | 'valuation' | 'documents', search: Search): string {
  const dealId = single(search['deal']) ?? single(search['dealId']);
  if (!dealId || !isUuidParam(dealId)) return '/deals';
  const rest = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = single(value);
    if (key !== 'deal' && key !== 'dealId' && first !== undefined) rest.set(key, first);
  }
  const query = rest.toString();
  return `/deals/${dealId}/${section}${query ? `?${query}` : ''}`;
}
