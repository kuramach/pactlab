import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { HelpLauncher } from '../components/help-launcher';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader, type Menus } from '../components/site-header';
import { siteConfig } from '../lib/config';
import { industryArt } from '../lib/content';
import { site } from '../lib/i18n/catalog';
import { HTML_LANG, isPublishedLocale, OG_LOCALE, PUBLISHED_LOCALES, type Locale } from '../lib/i18n/locales';
import { absolute, jsonLdScript, organizationJsonLd } from '../lib/seo';
import '../app/globals.css';

// Brand typeface. Self-hosted at build time by next/font; no runtime request to Google.
// Japanese falls back to the system's Japanese fonts (globals.css), which also break lines correctly.
const manrope = Manrope({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-manrope' });

/** The site-wide defaults, in one language. */
export function shellMetadata(locale: Locale): Metadata {
  const { content } = site(locale);
  const home = absolute(locale === 'en' ? '/' : `/${locale}`);
  return {
    metadataBase: new URL('https://pactlab.ai'),
    icons: {
      icon: [
        { url: '/brand/favicon.svg', type: 'image/svg+xml' },
        { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      ],
      apple: '/brand/apple-touch-icon.png',
    },
    title: { default: `Pactlab — ${content.tagline} ${content.descriptor}`, template: '%s · Pactlab' },
    description: content.home.body,
    openGraph: {
      title: `Pactlab — ${content.tagline}`,
      description: content.home.body,
      url: home,
      siteName: 'Pactlab',
      locale: OG_LOCALE[locale],
      images: [{ url: '/brand/icon-512.png', width: 512, height: 512, alt: 'Pactlab' }],
      type: 'website',
    },
    // An environment's copy of the site is never indexed (canonical URLs still point at pactlab.ai),
    // nor is a translation awaiting its native review.
    ...(siteConfig().indexed && isPublishedLocale(locale) ? {} : { robots: { index: false, follow: false } }),
  };
}

/** Cloudflare's beacon origin; the site's Content-Security-Policy must allow it (docs/runbooks/site-analytics.md). */
export const ANALYTICS_BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/**
 * Cloudflare Web Analytics (Kumar, 2026-11-28): no cookies, no personal data, marketing site only.
 * The embed as Cloudflare documents it for a site not proxied through Cloudflare, before </body>.
 */
function AnalyticsBeacon({ token }: { token: string }) {
  return <script type="module" src={ANALYTICS_BEACON_SRC} data-cf-beacon={JSON.stringify({ token })} />;
}

/** The menus, in the page's language. Hrefs are English paths; the header prefixes them. */
function menus(locale: Locale): Menus {
  const { content, ui, modules, industries } = site(locale);
  return {
    '/product': {
      title: content.nav.find((item) => item.href === '/product')?.label ?? ui.footer.product,
      items: modules.map((module) => ({ href: `/product/${module.slug}`, label: module.name, detail: module.summary, icon: module.icon })),
    },
    '/industries': {
      title: content.nav.find((item) => item.href === '/industries')?.label ?? ui.footer.industries,
      items: industries.map((industry) => ({
        href: `/industries/${industry.slug}`,
        label: industry.name,
        detail: industry.status === 'AVAILABLE' ? ui.shell.fullPack : ui.shell.industryPack,
        icon: industry.icon,
        image: industryArt(industry.slug),
      })),
    },
    '/about': {
      title: content.nav.find((item) => item.href === '/about')?.label ?? 'About',
      items: content.aboutPages.map((page) => ({ href: page.href, label: page.label, detail: page.detail, icon: page.icon })),
    },
  };
}

/** The document for one language: `<html lang>`, header with the language switcher, footer and organization JSON-LD. */
/** The top bar keeps the main sections only; everything else (case studies, trust, pilot, about, try it…) is in the footer (Kumar, 2026-11-27). */
const TOP_NAV: readonly string[] = ['/product', '/industries', '/how-it-works', '/pricing'];

export function SiteShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const { loginUrl, signUpUrl, contactHref, assistantUrl, analyticsToken } = siteConfig();
  const { content, ui } = site(locale);
  return (
    <html lang={HTML_LANG[locale]} className={manrope.variable}>
      <body className="bg-white font-sans text-navy antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          {ui.shell.skip}
        </a>
        <SiteHeader
          loginUrl={loginUrl}
          signUpUrl={signUpUrl}
          contactHref={contactHref}
          locale={locale}
          words={ui.shell}
          nav={content.nav.filter((item) => TOP_NAV.includes(item.href))}
          menus={menus(locale)}
          announcement={content.announcement}
          tagline={content.tagline}
          languages={PUBLISHED_LOCALES}
        />
        <main id="main">{children}</main>
        <SiteFooter locale={locale} />
        {assistantUrl ? <HelpLauncher assistantUrl={assistantUrl} /> : null}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd(locale)) }} />
        {analyticsToken ? <AnalyticsBeacon token={analyticsToken} /> : null}
      </body>
    </html>
  );
}
