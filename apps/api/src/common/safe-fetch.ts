import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { isBlockedAddress } from '../oauth/client-metadata';

/**
 * Fetching a URL a customer gave us (T-123: their website and logo) is an SSRF surface. This
 * fetcher is the only way to do it: https only, every resolved address checked and the
 * connection pinned to a checked one, redirects followed at most three times and each one
 * re-checked, a time cap and a size cap. Pattern from the OAuth metadata fetcher (T-084).
 */
export interface WebResponse {
  readonly url: URL;
  readonly status: number;
  readonly contentType: string;
  readonly body: Buffer;
}

export interface WebFetcher {
  get(url: URL, options: { maxBytes: number; accept: string }): Promise<WebResponse>;
}

export class SafeFetchError extends Error {
  constructor(readonly reason: 'NOT_HTTPS' | 'BLOCKED_ADDRESS' | 'TOO_LARGE' | 'TIMEOUT' | 'TOO_MANY_REDIRECTS' | 'FAILED') {
    super(reason);
    this.name = 'SafeFetchError';
  }
}

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

export class HttpsWebFetcher implements WebFetcher {
  async get(url: URL, options: { maxBytes: number; accept: string }): Promise<WebResponse> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (current.protocol !== 'https:' || current.username || current.password) throw new SafeFetchError('NOT_HTTPS');
      // Node skips the lookup for an address written as the host, so check it here, before connecting.
      const literal = current.hostname.replace(/^\[|\]$/g, '');
      if (isIP(literal) !== 0 && isBlockedAddress(literal)) throw new SafeFetchError('BLOCKED_ADDRESS');
      const response = await this.once(current, options);
      if (response.status >= 300 && response.status < 400 && response.location) {
        current = new URL(response.location, current);
        continue;
      }
      return { url: current, status: response.status, contentType: response.contentType, body: response.body };
    }
    throw new SafeFetchError('TOO_MANY_REDIRECTS');
  }

  private once(url: URL, options: { maxBytes: number; accept: string }): Promise<{ status: number; contentType: string; body: Buffer; location: string | null }> {
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          headers: { accept: options.accept, 'user-agent': 'PactlabBrandFetcher/1.0 (+https://pactlab.ai)' },
          timeout: TIMEOUT_MS,
          lookup: (hostname, lookupOptions, callback) => {
            dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
              if (error) return callback(error, '', 4);
              const list = addresses as LookupAddress[];
              const [first] = list;
              if (!first || list.some((entry) => isBlockedAddress(entry.address))) return callback(new SafeFetchError('BLOCKED_ADDRESS'), '', 4);
              if ((lookupOptions as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
              callback(null, first.address, first.family);
            });
          },
        },
        (response) => {
          const location = typeof response.headers.location === 'string' ? response.headers.location : null;
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > options.maxBytes) {
              req.destroy(new SafeFetchError('TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, contentType: String(response.headers['content-type'] ?? ''), body: Buffer.concat(chunks), location }));
        },
      );
      req.on('timeout', () => req.destroy(new SafeFetchError('TIMEOUT')));
      req.on('error', (error) => reject(error instanceof SafeFetchError ? error : new SafeFetchError('FAILED')));
      req.end();
    });
  }
}
