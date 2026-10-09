/** Minimal fetch signature the live adapters depend on; tests inject a replayer. */
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

export interface CassetteInteraction {
  readonly request: { readonly method: string; readonly path: string; readonly query: string };
  readonly response: {
    readonly status: number;
    /** Only headers the adapter reads (pagination, rate limit). */
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
  };
}

export interface Cassette {
  readonly cassetteVersion: 1;
  readonly provider: string;
  readonly source: string;
  readonly recordedAt: string;
  readonly interactions: readonly CassetteInteraction[];
}

export class UnrecordedRequestError extends Error {
  constructor(method: string, path: string) {
    super(`No recorded interaction for ${method} ${path}`);
    this.name = 'UnrecordedRequestError';
  }
}

/** Sorted query string, so parameter order never matters. */
export function normalizeQuery(search: string): string {
  const params = new URLSearchParams(search);
  return [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/**
 * Replays recorded provider responses. Anything not recorded throws, so
 * tests can never reach the provider.
 */
export function cassetteFetch(...cassettes: readonly Cassette[]): FetchLike & { requests: string[] } {
  const requests: string[] = [];
  const replay = async (input: string, init?: { method?: string }) => {
    const url = new URL(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const query = normalizeQuery(url.search);
    requests.push(`${method} ${url.pathname}${query ? `?${query}` : ''}`);
    const found = cassettes
      .flatMap((cassette) => cassette.interactions)
      .find((entry) => entry.request.method === method && entry.request.path === url.pathname && entry.request.query === query);
    if (!found) throw new UnrecordedRequestError(method, url.pathname);
    return new Response(found.response.body === null ? null : JSON.stringify(found.response.body), {
      status: found.response.status,
      headers: { 'content-type': 'application/json', ...found.response.headers },
    });
  };
  return Object.assign(replay, { requests });
}
