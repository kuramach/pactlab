import type { Metadata } from 'next';
import { guideMetadata, GuidePage, guideParams } from '../../../../views/guides';

export const dynamicParams = false;

export const generateStaticParams = guideParams;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata('en', (await params).slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <GuidePage locale="en" slug={slug} />;
}
