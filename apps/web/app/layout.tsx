import { PACTLAB_TAGLINE } from '@pactlab/ui';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Self-hosted at build time by next/font; no runtime request to Google.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'Pactlab', template: '%s · Pactlab' },
  description: PACTLAB_TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
