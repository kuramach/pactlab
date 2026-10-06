import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { HERO, TAGLINE } from '../lib/content';
import './globals.css';

// Brand typeface. Self-hosted at build time by next/font; no runtime request to Google.
const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope' });

export const metadata: Metadata = {
  metadataBase: new URL('https://pactlab.ai'),
  title: `Pactlab — ${TAGLINE}`,
  description: HERO.body,
  openGraph: {
    title: `Pactlab — ${TAGLINE}`,
    description: HERO.body,
    url: 'https://pactlab.ai',
    siteName: 'Pactlab',
    images: [{ url: '/brand/pactlab-symbol.png', width: 512, height: 512, alt: 'Pactlab' }],
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="bg-white font-sans text-navy antialiased">{children}</body>
    </html>
  );
}
