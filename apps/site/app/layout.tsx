import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { siteConfig } from '../lib/config';
import { DESCRIPTOR, HOME, TAGLINE } from '../lib/content';
import './globals.css';

// Brand typeface. Self-hosted at build time by next/font; no runtime request to Google.
const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope' });

export const metadata: Metadata = {
  metadataBase: new URL('https://pactlab.ai'),
  title: { default: `Pactlab — ${TAGLINE} ${DESCRIPTOR}`, template: '%s · Pactlab' },
  description: HOME.body,
  openGraph: {
    title: `Pactlab — ${TAGLINE}`,
    description: HOME.body,
    url: 'https://pactlab.ai',
    siteName: 'Pactlab',
    images: [{ url: '/brand/pactlab-symbol.png', width: 512, height: 512, alt: 'Pactlab' }],
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const { signInUrl } = siteConfig();
  return (
    <html lang="en" className={manrope.variable}>
      <body className="bg-white font-sans text-navy antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader signInUrl={signInUrl} />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
