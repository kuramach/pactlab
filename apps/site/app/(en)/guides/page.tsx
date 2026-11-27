import type { Metadata } from 'next';
import { GuidesIndexPage, guidesMetadata } from '../../../views/guides';

export const metadata: Metadata = guidesMetadata('en');

export default function Page() {
  return <GuidesIndexPage locale="en" />;
}
