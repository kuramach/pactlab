import type { Metadata } from 'next';
import { compareMetadata, ComparePage, compareParams } from '../../../../views/compare';

export const dynamicParams = false;

export const generateStaticParams = compareParams;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return compareMetadata('en', (await params).slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ComparePage locale="en" slug={slug} />;
}
