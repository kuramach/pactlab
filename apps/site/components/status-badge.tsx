import type { Industry } from '../lib/content';

/** Availability in words, never colour alone. */
export function StatusBadge({ industry, tone = 'light' }: { industry: Pick<Industry, 'status' | 'order'>; tone?: 'light' | 'dark' }) {
  const available = industry.status === 'AVAILABLE';
  const label = available ? 'Available in pilot' : `Planned · pack ${industry.order}`;
  const style = available
    ? 'bg-indigo text-navy'
    : tone === 'dark'
      ? 'border border-white/30 text-white/85'
      : 'border border-navy/20 text-navy/70';
  return <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-bold ${style}`}>{label}</span>;
}
