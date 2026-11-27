import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isTranslatedLocale } from '../../../../lib/i18n/locales';
import { faqMetadata, FaqPage, faqParams } from '../../../../views/faq';

export const dynamicParams = false;

export const generateStaticParams = faqParams;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  return isTranslatedLocale(locale) ? faqMetadata(locale, slug) : {};
}

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return <FaqPage locale={locale} slug={slug} />;
}
