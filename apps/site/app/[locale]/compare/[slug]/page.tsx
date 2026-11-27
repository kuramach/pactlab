import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isTranslatedLocale } from '../../../../lib/i18n/locales';
import { compareMetadata, ComparePage, compareParams } from '../../../../views/compare';

export const dynamicParams = false;

export const generateStaticParams = compareParams;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  return isTranslatedLocale(locale) ? compareMetadata(locale, slug) : {};
}

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return <ComparePage locale={locale} slug={slug} />;
}
