import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { shellMetadata, SiteShell } from '../../views/shell';

/** Root layout for English, unprefixed: the US, the UK, India and everyone else. */
export const metadata: Metadata = shellMetadata('en');

export default function EnglishLayout({ children }: { children: ReactNode }) {
  return <SiteShell locale="en">{children}</SiteShell>;
}
