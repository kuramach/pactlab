import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * OAuth Client ID Metadata Documents (T-084; draft-ietf-oauth-client-id-metadata-document-00,
 * as the MCP authorization spec 2026-07-28 requires): an MCP client's `client_id` is an https
 * URL whose JSON names the client and its redirect URIs. Fetching a URL a stranger chose is an
 * SSRF risk, so: https only, no redirects, a 5-second timeout and a 64 KB cap, and every
 * resolved address is checked against private, loopback, link-local and reserved ranges —
 * the connection is made to the checked address itself, so DNS cannot change in between.
 */
export interface ClientMetadata {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
}

export interface ClientMetadataFetcher {
  fetch(clientId: string): Promise<ClientMetadata>;
}

export class ClientMetadataError extends Error {
  constructor(readonly reason: 'INVALID_URL' | 'BLOCKED_ADDRESS' | 'FETCH_FAILED' | 'INVALID_DOCUMENT') {
    super(reason);
    this.name = 'ClientMetadataError';
  }
}

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_CACHE_SECONDS = 24 * 60 * 60;

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96]] as const) blocked.addSubnet(network, prefix, 'ipv6');

/** True for any address an outbound fetch must never reach (IPv4-mapped IPv6 included). */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    if (mapped) return blocked.check(mapped, 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return blocked.check(address, 'ipv4');
}

/** A client_id that can be a metadata document URL: https, a host that is a name, a path. */
export function isClientMetadataUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.pathname.length > 1 && !url.hash && !url.username && !url.password && isIP(url.hostname.replace(/^\[|\]$/g, '')) === 0;
}

/** A redirect URI a client may register: https anywhere, or http on loopback (native apps); never a fragment. */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

function parseDocument(clientId: string, text: string): ClientMetadata {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new ClientMetadataError('INVALID_DOCUMENT');
  }
  const record = (document ?? {}) as Record<string, unknown>;
  const name = record['client_name'];
  const redirects = record['redirect_uris'];
  if (record['client_id'] !== clientId) throw new ClientMetadataError('INVALID_DOCUMENT');
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 120) throw new ClientMetadataError('INVALID_DOCUMENT');
  if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 10) throw new ClientMetadataError('INVALID_DOCUMENT');
  if (!redirects.every((uri): uri is string => typeof uri === 'string' && isAllowedRedirectUri(uri))) throw new ClientMetadataError('INVALID_DOCUMENT');
  return { clientId, clientName: name.trim(), redirectUris: redirects };
}

/** The live fetcher, with a small cache honouring Cache-Control max-age (at most 24 hours). */
export class HttpsClientMetadataFetcher implements ClientMetadataFetcher {
  private readonly cache = new Map<string, { value: ClientMetadata; until: number }>();

  async fetch(clientId: string): Promise<ClientMetadata> {
    if (!isClientMetadataUrl(clientId)) throw new ClientMetadataError('INVALID_URL');
    const cached = this.cache.get(clientId);
    if (cached && cached.until > Date.now()) return cached.value;
    const { body, maxAge } = await this.get(new URL(clientId));
    const value = parseDocument(clientId, body);
    if (maxAge > 0) this.cache.set(clientId, { value, until: Date.now() + Math.min(maxAge, MAX_CACHE_SECONDS) * 1000 });
    return value;
  }

  private get(url: URL): Promise<{ body: string; maxAge: number }> {
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          headers: { accept: 'application/json' },
          timeout: TIMEOUT_MS,
          // Resolve, check every address, and connect only to a checked one.
          lookup: (hostname, options, callback) => {
            dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
              if (error) return callback(error, '', 4);
              const list = addresses as LookupAddress[];
              const [first] = list;
              if (!first || list.some((entry) => isBlockedAddress(entry.address))) return callback(new ClientMetadataError('BLOCKED_ADDRESS'), '', 4);
              if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
              callback(null, first.address, first.family);
            });
          },
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            return reject(new ClientMetadataError('FETCH_FAILED'));
          }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              req.destroy();
              reject(new ClientMetadataError('INVALID_DOCUMENT'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const maxAge = Number(/max-age=(\d+)/.exec(String(response.headers['cache-control'] ?? ''))?.[1] ?? 0);
            resolve({ body: Buffer.concat(chunks).toString('utf8'), maxAge });
          });
        },
      );
      req.on('timeout', () => req.destroy(new ClientMetadataError('FETCH_FAILED')));
      req.on('error', (error) => reject(error instanceof ClientMetadataError ? error : new ClientMetadataError('FETCH_FAILED')));
      req.end();
    });
  }
}

/** Tests and local runs: documents served from memory, through the same validation. */
export class FixtureClientMetadataFetcher implements ClientMetadataFetcher {
  constructor(private readonly documents: Readonly<Record<string, unknown>>) {}

  async fetch(clientId: string): Promise<ClientMetadata> {
    if (!isClientMetadataUrl(clientId)) throw new ClientMetadataError('INVALID_URL');
    const document = this.documents[clientId];
    if (document === undefined) throw new ClientMetadataError('FETCH_FAILED');
    return parseDocument(clientId, JSON.stringify(document));
  }
}
