import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { authorizeUrl, CloudDestinationError, CloudSession, createPkce, exchangeCode, type CloudClient, type CloudProvider } from './cloud';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The Rinse app's own registrations with each drive (public clients), baked into the sidecar at build
 * time (`scripts/build-sidecar.mjs`, from RINSE_<PROVIDER>_CLIENT_ID). A client id is not a secret. Box's
 * token endpoint also needs the app's client secret, which a desktop app cannot keep, so Box stays off
 * until it is registered and that risk is accepted (docs/runbooks/rinse.md).
 */
export type CloudClientIds = Partial<Readonly<Record<CloudProvider, string>>>;

const CLOSE_PAGE = (ok: boolean) =>
  `<!doctype html><meta charset="utf-8"><title>Pactlab Rinse</title><body style="font-family:system-ui;padding:3rem;color:#081127">${ok ? 'Signed in. You can close this window and go back to Pactlab Rinse.' : 'The sign-in did not complete. Go back to Pactlab Rinse and try again.'}</body>`;

/**
 * One sign-in with the seller's own drive: a loopback listener on 127.0.0.1 (RFC 8252), PKCE (RFC 7636),
 * the state checked on return. `start` gives the address to open in the seller's browser; `session`
 * settles when the provider sends the seller back (or after five minutes). The token stays here.
 */
export async function startCloudSignIn(provider: CloudProvider, clientIds: CloudClientIds, fetcher: Fetch = fetch, timeoutMs = 5 * 60_000): Promise<{ url: string; session: Promise<CloudSession> }> {
  const clientId = clientIds[provider];
  if (!clientId || provider === 'BOX') throw new CloudDestinationError('REFUSED', 'this drive is not registered for Pactlab Rinse yet');
  const { verifier, challenge } = createPkce();
  const state = randomBytes(16).toString('base64url');
  let settle!: { resolve: (session: CloudSession) => void; reject: (error: Error) => void };
  const session = new Promise<CloudSession>((resolve, reject) => (settle = { resolve, reject }));
  const client: { current: CloudClient | null } = { current: null };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      response.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get('code');
    const good = url.searchParams.get('state') === state && code !== null;
    response.writeHead(good ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' }).end(CLOSE_PAGE(good));
    server.close();
    if (!good) {
      settle.reject(new CloudDestinationError('REFUSED', 'the sign-in did not match'));
      return;
    }
    const registered = client.current;
    if (!registered) return;
    exchangeCode(provider, registered, code, verifier, fetcher).then((token) => settle.resolve(new CloudSession(provider, registered, token, fetcher)), settle.reject);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const timer = setTimeout(() => {
    server.close();
    settle.reject(new CloudDestinationError('REFUSED', 'the sign-in timed out'));
  }, timeoutMs);
  // handled: the window shows the drive as not signed in, with the reason, and offers to try again.
  session.catch(() => undefined).finally(() => clearTimeout(timer));
  client.current = { clientId, redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback` };
  return { url: authorizeUrl(provider, client.current, state, challenge), session };
}
