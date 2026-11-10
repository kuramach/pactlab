import { headers } from 'next/headers';
import { safeReturnTo, SIGN_IN_PATH } from './auth-flow';

/**
 * Where to sign in again for a sensitive action (T-112), returning to the page the action
 * came from. Server actions only: the page is the request's referer, kept to its path.
 */
export async function signInAgainPath(): Promise<string> {
  const referer = (await headers()).get('referer');
  let returnTo = '/';
  try {
    const url = referer ? new URL(referer) : null;
    if (url) returnTo = safeReturnTo(`${url.pathname}${url.search}`);
  } catch {
    returnTo = '/';
  }
  return `${SIGN_IN_PATH}?${new URLSearchParams({ reauth: '1', returnTo })}`;
}
