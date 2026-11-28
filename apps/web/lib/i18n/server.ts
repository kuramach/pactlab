import { cookies } from 'next/headers';
import { cache } from 'react';
import { i18nFor, type I18n } from './index';
import { APP_LOCALE_COOKIE, resolveLocale } from './locales';

/**
 * The reader's i18n for this request: the person's own choice over their organization's default over English
 * (ADR 0064). The person's choice is stored on this device from Settings → Language. The organization's default
 * and a choice that follows the person across devices need stored columns (T-172b); until then there is none.
 */
export const getI18n = cache(async (): Promise<I18n> => {
  const store = await cookies();
  return i18nFor(resolveLocale({ user: store.get(APP_LOCALE_COOKIE)?.value, organization: null }));
});
