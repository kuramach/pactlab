'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { BRAND_PROMPT_COOKIE } from '../../../lib/brand';
import { serverEnv } from '../../../lib/env';

/** "Not now" on the website ask (T-123): hidden on this browser; Settings → Brand still has it. */
export async function skipBrandPrompt(): Promise<void> {
  (await cookies()).set(BRAND_PROMPT_COOKIE, 'skip', { httpOnly: true, secure: serverEnv().APP_BASE_URL.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: 365 * 24 * 60 * 60 });
  revalidatePath('/');
}
