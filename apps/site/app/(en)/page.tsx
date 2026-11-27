import type { Metadata } from 'next';
import { homeMetadata, HomePage } from '../../views/home';

export const metadata: Metadata = homeMetadata('en');

export default function EnglishHomePage() {
  return <HomePage locale="en" />;
}
