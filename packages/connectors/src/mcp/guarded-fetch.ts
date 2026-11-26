import type { FetchLike } from '../http/cassette';
import { McpAdapterError, type AllowedMcpServer } from './types';

/** The fetch shape the MCP SDK's client transport calls. */
export type SdkFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export const MCP_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const MCP_REQUEST_TIMEOUT_MS = 20_000;

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function headersOf(init: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new McpAdapterError('TOO_LARGE');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Every request the MCP client makes goes through here (T-084c), with the posture of the
 * Jira allowlist (T-082) and the client-metadata fetcher (T-084):
 * - only the approved endpoint itself, over https; anything else is refused before a byte leaves;
 * - POST (messages) and DELETE (ending a session) only. A GET would open a standing stream from
 *   the server; it is answered 405 locally, which the MCP spec lets a client treat as "no stream";
 * - redirects are never followed; a 3xx is unreachable;
 * - a time cap and a size cap on every response, read in full before the SDK sees it.
 * The base fetch is the deployment's pinned fetch, which checks every resolved address.
 */
export function guardedMcpFetch(
  server: AllowedMcpServer,
  base: FetchLike,
  headers: Readonly<Record<string, string>>,
): SdkFetch {
  const endpoint = new URL(server.url);
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.href);
    if (
      url.protocol !== 'https:' ||
      url.origin !== endpoint.origin ||
      url.pathname !== endpoint.pathname ||
      url.search ||
      url.hash
    )
      throw new McpAdapterError('NOT_ALLOWED');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') return new Response(null, { status: 405 });
    if (method !== 'POST' && method !== 'DELETE') throw new McpAdapterError('NOT_ALLOWED');
    if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string')
      throw new McpAdapterError('PROTOCOL');
    const timeout = AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS);
    const response = await base(url.href, {
      method,
      // Ours last, in one case, so nothing the SDK sets can replace the credential or the read-only switch.
      headers: { ...headersOf(init?.headers), ...headersOf(headers) },
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) throw new McpAdapterError('UNREACHABLE');
    const body = await readCapped(response, MCP_RESPONSE_MAX_BYTES);
    const out = new Headers(response.headers);
    // The bytes are already decoded and counted; these would describe the original transfer.
    out.delete('content-encoding');
    out.delete('content-length');
    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: out,
    });
  };
}
