import { PACTLAB_TAGLINE } from '@pactlab/ui';
import type { Metadata } from 'next';
import { Inter, Manrope, Source_Serif_4 } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Brand typeface. Self-hosted at build time by next/font; no runtime request to Google.
const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope' });
// The other fonts an organization's brand kit may choose (T-123); loaded only where used.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter', preload: false });
const sourceSerif = Source_Serif_4({ subsets: ['latin'], display: 'swap', variable: '--font-source-serif', preload: false });

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: '/brand/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/brand/apple-touch-icon.png',
  },
  title: { default: 'Pactlab', template: '%s · Pactlab' },
  description: PACTLAB_TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${inter.variable} ${sourceSerif.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
