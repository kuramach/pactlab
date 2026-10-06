import { PACTLAB_TAGLINE } from '@pactlab/ui';
import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Brand typeface. Self-hosted at build time by next/font; no runtime request to Google.
const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope' });

export const metadata: Metadata = {
  title: { default: 'Pactlab', template: '%s · Pactlab' },
  description: PACTLAB_TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
