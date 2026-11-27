import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isTranslatedLocale } from '../../../../lib/i18n/locales';
import { storyMetadata, StoryPage } from '../../../../views/about';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return isTranslatedLocale(locale) ? storyMetadata(locale) : {};
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return <StoryPage locale={locale} />;
}
