import Link from 'next/link';
import { siteConfig } from '../lib/config';

/**
 * Primary call to action. The pilot button renders only when a contact
 * address is configured; otherwise the band links to the pilot page.
 */
export function PilotButton({ label = 'Request a pilot' }: { label?: string }) {
  const { contactHref } = siteConfig();
  if (!contactHref) return null;
  return (
    <a href={contactHref} className="inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy hover:bg-white">
      {label}
    </a>
  );
}

/** Secondary call to action: create an organization in the app. */
export function SignUpLink({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { signUpUrl } = siteConfig();
  if (!signUpUrl) return null;
  return (
    <a
      href={signUpUrl}
      className={
        tone === 'dark'
          ? 'inline-flex items-center rounded-lg border border-white/40 px-5 py-3 font-bold text-white hover:border-white'
          : 'inline-flex items-center rounded-lg border border-navy/25 px-5 py-3 font-bold text-navy hover:border-navy'
      }
    >
      Sign up
    </a>
  );
}

export function CtaBand({ title, body, label }: { title: string; body: string; label?: string }) {
  return (
    <section className="bg-mist">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight">{title}</h2>
          <p className="mt-3 text-lg text-slate-text">{body}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <PilotButton {...(label ? { label } : {})} />
          <SignUpLink />
          <Link href="/pilot" className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
            What a pilot includes →
          </Link>
        </div>
      </div>
    </section>
  );
}
