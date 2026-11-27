import type { Metadata } from 'next';
import { visionMetadata, VisionPage } from '../../../../views/about';

export const metadata: Metadata = visionMetadata('en');

export default function Page() {
  return <VisionPage locale="en" />;
}
