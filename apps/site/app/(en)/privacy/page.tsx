import type { Metadata } from 'next';
import { LegalPage } from '../../../components/legal-page';
import { PRIVACY } from '../../../lib/legal';
import { pageMetadata } from '../../../lib/seo';

export const metadata: Metadata = pageMetadata({ title: PRIVACY.title, description: PRIVACY.summary, path: '/privacy' });

export default function PrivacyPage() {
  return <LegalPage document={PRIVACY} />;
}
