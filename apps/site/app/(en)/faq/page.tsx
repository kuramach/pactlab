import type { Metadata } from 'next';
import { faqIndexMetadata, FaqIndexPage } from '../../../views/faq';

export const metadata: Metadata = faqIndexMetadata('en');

export default function Page() {
  return <FaqIndexPage locale="en" />;
}
