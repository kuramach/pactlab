import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isTranslatedLocale } from '../../../lib/i18n/locales';
import { CaseStudiesIndexPage, caseStudiesMetadata } from '../../../views/case-studies';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return isTranslatedLocale(locale) ? caseStudiesMetadata(locale) : {};
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return <CaseStudiesIndexPage locale={locale} />;
}
