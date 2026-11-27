import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

/**
 * The site's 404 (out/404/index.html, served by CloudFront for any missing
 * key). Each language has its own root layout (T-171), so the 404 is
 * self-contained; it offers every language's home page.
 */
export const metadata: Metadata = { title: 'Page not found · Pactlab', robots: { index: false, follow: false } };

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="bg-white font-sans text-navy antialiased">
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-6 px-6">
          <img src="/brand/pactlab-logo.svg" alt="Pactlab" width={157} height={60} />
          <h1 className="text-4xl font-extrabold tracking-tight">Page not found</h1>
          <p className="text-lg text-slate-text">The page you asked for is not here.</p>
          <Link href="/" className="inline-flex items-center rounded-lg bg-navy px-5 py-3 font-bold text-white hover:bg-indigo hover:text-navy">
            Pactlab home
          </Link>
        </main>
      </body>
    </html>
  );
}
