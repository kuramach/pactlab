import type { Industry } from '../lib/content';
import { site } from '../lib/i18n/catalog';
import { fill } from '../lib/i18n/localize';
import type { Locale } from '../lib/i18n/locales';

/** Availability in words, never colour alone. */
export function StatusBadge({ industry, tone = 'light', locale = 'en' }: { industry: Pick<Industry, 'status' | 'order'>; tone?: 'light' | 'dark'; locale?: Locale }) {
  const available = industry.status === 'AVAILABLE';
  const words = site(locale).ui.industries;
  const label = available ? words.available : fill(words.planned, { order: industry.order ?? '' });
  const style = available
    ? 'bg-indigo text-navy'
    : tone === 'dark'
      ? 'border border-white/30 text-white/85'
      : 'border border-navy/20 text-navy/70';
  return <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-bold ${style}`}>{label}</span>;
}
