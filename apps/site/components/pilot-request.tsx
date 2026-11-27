'use client';

import { useEffect, useState } from 'react';
import { COUNTRY_COOKIE } from '../lib/i18n/locales';

/** The country the edge saw (CloudFront-Viewer-Country), when it set the cookie. */
export function viewerCountry(cookies: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${COUNTRY_COOKIE}=([A-Z]{2})(?:;|$)`).exec(cookies);
  return match?.[1] ?? null;
}

/** The pilot request email with the country pre-selected: `Country: Germany`, named in the page's language. */
export function withCountry(href: string, country: string | null, { label, language }: { label: string; language: string }): string {
  if (!country || !href.startsWith('mailto:')) return href;
  const name = new Intl.DisplayNames([language], { type: 'region' }).of(country) ?? country;
  return `${href}${href.includes('?') ? '&' : '?'}body=${encodeURIComponent(`${label}: ${name}\n`)}`;
}

/**
 * The pilot request link (T-171 Build 4). There is no form: a pilot request
 * is an email, so the detected country is pre-filled in its body, where the
 * visitor can change it. Without the cookie the link is unchanged.
 */
export function PilotRequest({ href, className, label, countryLabel, language }: { href: string; className: string; label: string; countryLabel: string; language: string }) {
  const [target, setTarget] = useState(href);
  useEffect(() => {
    setTarget(withCountry(href, viewerCountry(document.cookie), { label: countryLabel, language }));
  }, [href, countryLabel, language]);
  return (
    <a href={target} className={className}>
      {label}
    </a>
  );
}
