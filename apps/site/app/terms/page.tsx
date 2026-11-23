import type { Metadata } from 'next';
import { LegalPage } from '../../components/legal-page';
import { TERMS } from '../../lib/legal';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({ title: TERMS.title, description: TERMS.summary, path: '/terms' });

export default function TermsPage() {
  return <LegalPage document={TERMS} />;
}
