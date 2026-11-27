import Link from 'next/link';
import { siteConfig } from '../lib/config';
import { site } from '../lib/i18n/catalog';
import { HTML_LANG, localeHref, type Locale } from '../lib/i18n/locales';
import { PilotRequest } from './pilot-request';

/**
 * Primary call to action. The pilot button renders only when a contact
 * address is configured; otherwise the band links to the pilot page.
 */
export function PilotButton({ label, locale = 'en' }: { label?: string; locale?: Locale }) {
  const { contactHref } = siteConfig();
  if (!contactHref) return null;
  return (
    <PilotRequest
      href={contactHref}
      className="inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy hover:bg-white"
      label={label ?? site(locale).ui.cta.requestPilot}
      countryLabel={site(locale).ui.cta.country}
      language={HTML_LANG[locale]}
    />
  );
}

/** Secondary call to action: create an organization in the app. */
export function SignUpLink({ tone = 'light', locale = 'en' }: { tone?: 'light' | 'dark'; locale?: Locale }) {
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
      {site(locale).ui.cta.signUp}
    </a>
  );
}

export function CtaBand({ title, body, label, locale = 'en' }: { title: string; body: string; label?: string; locale?: Locale }) {
  const words = site(locale).ui.cta;
  return (
    <section className="bg-mist">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight">{title}</h2>
          <p className="mt-3 text-lg text-slate-text">{body}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <PilotButton locale={locale} {...(label ? { label } : {})} />
          <SignUpLink locale={locale} />
          <Link href={localeHref(locale, '/pilot')} className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
            {words.pilotIncludes}
          </Link>
        </div>
      </div>
    </section>
  );
}
