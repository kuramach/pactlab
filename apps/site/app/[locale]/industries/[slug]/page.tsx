import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isTranslatedLocale } from '../../../../lib/i18n/locales';
import { industryMetadata, IndustryPage, industryParams } from '../../../../views/industries';

export const dynamicParams = false;

export const generateStaticParams = industryParams;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  return isTranslatedLocale(locale) ? industryMetadata(locale, slug) : {};
}

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return <IndustryPage locale={locale} slug={slug} />;
}
