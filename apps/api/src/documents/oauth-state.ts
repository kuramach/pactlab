import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DocumentOAuthProvider } from '@pactlab/connectors';

/**
 * The OAuth `state` of a drive sign-in (T-147): who started it, for what, until when, signed with the
 * API's secret so it cannot be forged, altered or replayed by another person. Both kinds come back to
 * the provider's one registered callback, so the state says which it is:
 * - `org`: the organization's sign-in (Settings → Document sources);
 * - `pact`: one person's sign-in for one folder on one pact (the pact's Documents page).
 * Nothing secret is in it; the provider echoes it back unchanged.
 */
export type SignInState =
  | { readonly k: 'org'; readonly o: string; readonly u: string; readonly p: DocumentOAuthProvider; readonly e: number }
  | {
      readonly k: 'pact';
      readonly o: string;
      readonly u: string;
      readonly p: DocumentOAuthProvider;
      readonly e: number;
      /** The deal, the folder to read, and the name the person gave it. */
      readonly d: string;
      readonly f: string;
      readonly n: string;
    };

const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(`document-source-state:v2:${payload}`).digest('base64url');

export function signState(secret: string, state: SignInState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

/** The state when its signature holds and it has not expired; null otherwise (never a reason why). */
export function readState(secret: string, text: string, now: number = Date.now()): SignInState | null {
  const [payload, signature, ...rest] = text.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let state: SignInState;
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SignInState;
  } catch {
    return null;
  }
  if (typeof state.e !== 'number' || state.e < now) return null;
  return state;
}
