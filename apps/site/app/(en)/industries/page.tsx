import type { Metadata } from 'next';
import { industriesMetadata, IndustriesPage } from '../../../views/industries';

export const metadata: Metadata = industriesMetadata('en');

export default function Page() {
  return <IndustriesPage locale="en" />;
}
