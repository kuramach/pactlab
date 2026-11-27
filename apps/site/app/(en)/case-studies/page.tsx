import type { Metadata } from 'next';
import { CaseStudiesIndexPage, caseStudiesMetadata } from '../../../views/case-studies';

export const metadata: Metadata = caseStudiesMetadata('en');

export default function Page() {
  return <CaseStudiesIndexPage locale="en" />;
}
