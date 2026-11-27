import type { Metadata } from 'next';
import { aboutMetadata, AboutPage } from '../../../views/about';

export const metadata: Metadata = aboutMetadata('en');

export default function Page() {
  return <AboutPage locale="en" />;
}
