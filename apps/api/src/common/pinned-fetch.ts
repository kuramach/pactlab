import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import type { FetchLike } from '@pactlab/connectors';
import { isBlockedAddress } from '../oauth/client-metadata';

/**
 * The fetch behind live MCP evidence servers (T-084c): the operator's allowlist decides the
 * host, and this decides the address. https only; an IP literal or any resolved address in a
 * private, loopback, link-local or reserved range is refused, and the connection is made to
 * the checked address itself, so DNS cannot change in between (the client-metadata fetcher's
 * posture, T-084). Redirects are returned, never followed; bodies are capped.
 */
export function pinnedHttpsFetch(options: { maxBytes: number; timeoutMs: number }): FetchLike {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input);
      if (url.protocol !== 'https:' || url.username || url.password)
        return reject(new TypeError('fetch refused: not https'));
      const literal = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(literal) !== 0 && isBlockedAddress(literal))
        return reject(new TypeError('fetch refused: blocked address'));
      const req = request(
        url,
        {
          method: init?.method ?? 'GET',
          headers: init?.headers ?? {},
          timeout: options.timeoutMs,
          ...(init?.signal ? { signal: init.signal } : {}),
          lookup: (hostname, lookupOptions, callback) => {
            dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
              if (error) return callback(error, '', 4);
              const list = addresses as LookupAddress[];
              const [first] = list;
              if (!first || list.some((entry) => isBlockedAddress(entry.address)))
                return callback(new TypeError('fetch refused: blocked address'), '', 4);
              if ((lookupOptions as { all?: boolean }).all)
                return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
              callback(null, first.address, first.family);
            });
          },
        },
        (response) => {
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > options.maxBytes) {
              req.destroy(new TypeError('fetch refused: response too large'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
              if (value === undefined) continue;
              for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
            }
            const status = response.statusCode ?? 502;
            resolve(
              new Response([101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
                status,
                headers,
              }),
            );
          });
          response.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new TypeError('fetch refused: timed out')));
      req.on('error', (error) =>
        reject(error instanceof TypeError ? error : new TypeError('fetch failed')),
      );
      if (init?.body !== undefined) req.write(init.body);
      req.end();
    });
}
