'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { GUIDE_COOKIE } from '../../../lib/showcase';
import { serverEnv } from '../../../lib/env';

const ONE_YEAR = 365 * 24 * 60 * 60;

/** Hide the guided tour and "Why this matters" callouts on this browser (Settings brings them back). */
export async function hideGuide(): Promise<void> {
  (await cookies()).set(GUIDE_COOKIE, 'off', { httpOnly: true, secure: serverEnv().APP_BASE_URL.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: ONE_YEAR });
  revalidatePath('/', 'layout');
}

export async function showGuide(): Promise<void> {
  (await cookies()).delete({ name: GUIDE_COOKIE, path: '/' });
  revalidatePath('/', 'layout');
}

export async function guideHidden(): Promise<boolean> {
  return (await cookies()).get(GUIDE_COOKIE)?.value === 'off';
}
