import type { Metadata } from 'next';
import { faqMetadata, FaqPage, faqParams } from '../../../../views/faq';

export const dynamicParams = false;

export const generateStaticParams = faqParams;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return faqMetadata('en', (await params).slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <FaqPage locale="en" slug={slug} />;
}
