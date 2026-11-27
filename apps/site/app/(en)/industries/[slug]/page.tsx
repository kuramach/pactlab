import type { Metadata } from 'next';
import { industryMetadata, IndustryPage, industryParams } from '../../../../views/industries';

export const dynamicParams = false;

export const generateStaticParams = industryParams;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return industryMetadata('en', (await params).slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <IndustryPage locale="en" slug={slug} />;
}
