'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { APP_LOCALE_COOKIE, APP_LOCALE_COOKIE_MAX_AGE, isOfferedLocale } from '../../../lib/i18n/locales';

/**
 * The reader's language (T-172): stored on this device, read on the next request, so switching is instant. Only a
 * language that is offered is stored; anything else is refused. Never a security decision: the API is unaffected.
 */
export async function setLanguage(formData: FormData): Promise<void> {
  const value = formData.get('locale');
  if (!isOfferedLocale(value)) redirect('/settings?outcome=language-invalid#language');
  (await cookies()).set(APP_LOCALE_COOKIE, value, { path: '/', maxAge: APP_LOCALE_COOKIE_MAX_AGE, sameSite: 'lax', secure: process.env['NODE_ENV'] === 'production', httpOnly: true });
  redirect('/settings?outcome=language-saved#language');
}
