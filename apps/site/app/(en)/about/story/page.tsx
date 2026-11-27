import type { Metadata } from 'next';
import { storyMetadata, StoryPage } from '../../../../views/about';

export const metadata: Metadata = storyMetadata('en');

export default function Page() {
  return <StoryPage locale="en" />;
}
