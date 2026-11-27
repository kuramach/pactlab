import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isTranslatedLocale } from '../../../lib/i18n/locales';
import { aboutMetadata, AboutPage } from '../../../views/about';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return isTranslatedLocale(locale) ? aboutMetadata(locale) : {};
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return <AboutPage locale={locale} />;
}
