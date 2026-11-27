import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isTranslatedLocale } from '../../../../lib/i18n/locales';
import { guideMetadata, GuidePage, guideParams } from '../../../../views/guides';

export const dynamicParams = false;

export const generateStaticParams = guideParams;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  return isTranslatedLocale(locale) ? guideMetadata(locale, slug) : {};
}

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return <GuidePage locale={locale} slug={slug} />;
}
