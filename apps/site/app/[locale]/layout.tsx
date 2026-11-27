import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isTranslatedLocale, TRANSLATED_LOCALES } from '../../lib/i18n/locales';
import { shellMetadata, SiteShell } from '../../views/shell';

/** Root layout for /de, /fr and /ja (T-171). Every translation is built; unreviewed ones are noindex and unlinked. */
export const dynamicParams = false;

export function generateStaticParams() {
  return TRANSLATED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return isTranslatedLocale(locale) ? shellMetadata(locale) : {};
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return <SiteShell locale={locale}>{children}</SiteShell>;
}
