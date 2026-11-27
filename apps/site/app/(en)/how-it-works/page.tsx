import type { Metadata } from 'next';
import { howItWorksMetadata, HowItWorksPage } from '../../../views/how-it-works';

export const metadata: Metadata = howItWorksMetadata('en');

export default function Page() {
  return <HowItWorksPage locale="en" />;
}
