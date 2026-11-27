import type { Metadata } from 'next';
import { rinseMetadata, RinsePage } from '../../../views/rinse';

export const metadata: Metadata = rinseMetadata('en');

export default function Page() {
  return <RinsePage locale="en" />;
}
