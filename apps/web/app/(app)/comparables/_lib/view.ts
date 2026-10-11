import type { BenchmarkView, ComparableView, MultiplePlacementView } from '@pactlab/contracts';

export const ORIGIN_LABELS: Record<ComparableView['origin'], string> = {
  OWN_DEAL: 'Our deals',
  ENTERED: 'Entered with a source',
  PROVIDER: 'Data provider',
  SYNTHETIC: 'Synthetic (demo only)',
};

export const KIND_LABELS: Record<ComparableView['kind'], string> = {
  PRECEDENT_TRANSACTION: 'Precedent transaction',
  PUBLIC_PEER: 'Public peer',
  OWN_DEAL: 'Our deal',
};

export const POSITION_LABELS: Record<MultiplePlacementView['position'], string> = {
  BELOW_RANGE: 'below every comparable',
  LOW: 'in the lower quarter',
  MID: 'in the middle half',
  HIGH: 'in the upper quarter',
  ABOVE_RANGE: 'above every comparable',
};

export const VERDICT_LABELS: Record<'IN_RANGE' | 'HIGH' | 'LOW', string> = {
  IN_RANGE: 'In range',
  HIGH: 'High',
  LOW: 'Low',
};

export const DRIVER_LABELS: Record<BenchmarkView['drivers'][number]['key'], string> = {
  ARR_GROWTH: 'ARR growth (YoY)',
  NRR: 'NRR',
  GRR: 'GRR',
};

/** `4` → `4.0×`; `4.25` → `4.25×`. Display only. */
export function formatMultiple(multiple: string): string {
  const [whole = '0', fraction = ''] = multiple.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${whole}.${trimmed.length === 0 ? '0' : trimmed}×`;
}

/** `'0.2500'` → `25%`, `'1.0850'` → `108.5%`. String arithmetic only. */
export function fractionToPercentLabel(fraction: string | null): string {
  if (fraction === null) return '—';
  const negative = fraction.startsWith('-');
  const [whole = '0', decimals = ''] = fraction.replace('-', '').split('.');
  const digits = `${whole}${decimals.padEnd(4, '0')}`.replace(/^0+(?=\d)/, '');
  const padded = digits.padStart(5, '0');
  const integer = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  const rest = padded.slice(-2).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${rest ? `.${rest}` : ''}%`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

const COMPANY_TYPE_WORDS: Record<string, string> = {
  SOFTWARE_SAAS: 'software',
  FINTECH: 'fintech',
  HEALTHCARE: 'healthcare',
  TELECOM_MEDIA: 'telecom & media',
  PROFESSIONAL_SERVICES: 'professional-services',
  PHARMA_BIOTECH: 'pharma & biotech',
  ECOMMERCE_DTC: 'e-commerce',
  OTHER: '',
  ALL: '',
};

/** "16 software comparables from the last 5 years" */
export function describeSet(view: Pick<BenchmarkView, 'count' | 'filter'>): string {
  const type = COMPANY_TYPE_WORDS[view.filter.companyType] ?? '';
  const noun = view.count === 1 ? 'comparable' : 'comparables';
  const when = view.filter.years === 0 ? 'of any date' : `from the last ${view.filter.years} years`;
  return `${view.count} ${type ? `${type} ` : ''}${noun} ${when}`;
}

/** "4.0× sits at the 27th percentile — in the middle half." */
export function describePlacement(placement: MultiplePlacementView): string {
  return `${formatMultiple(placement.multiple)} sits at the ${ordinal(placement.percentile)} percentile — ${POSITION_LABELS[placement.position]}`;
}

/** "The ask implies 5.04× — the 56th percentile, in the middle half." */
export function describeAskPlacement(placement: MultiplePlacementView): string {
  return `The ask implies ${formatMultiple(placement.multiple)} — the ${ordinal(placement.percentile)} percentile, ${POSITION_LABELS[placement.position]}`;
}

/** The comparison of each driver in plain words. */
export function describeDriver(driver: BenchmarkView['drivers'][number]): string {
  if (driver.target === null) return 'Not measurable from the evidence yet';
  if (driver.median === null) return 'No comparable reports it';
  return driver.comparison === 'STRONGER' ? 'Stronger than peers' : driver.comparison === 'WEAKER' ? 'Weaker than peers' : 'In line with peers';
}

/**
 * What the evidence suggests for the multiple — a description, never a
 * decision: drivers stronger than peers support the upper half, weaker ones
 * the lower half.
 */
export function driverSignal(drivers: BenchmarkView['drivers']): 'UPPER' | 'LOWER' | 'MIXED' | null {
  const compared = drivers.filter((driver) => driver.comparison !== null);
  if (compared.length === 0) return null;
  const score = compared.reduce((total, driver) => total + (driver.comparison === 'STRONGER' ? 1 : driver.comparison === 'WEAKER' ? -1 : 0), 0);
  return score > 0 ? 'UPPER' : score < 0 ? 'LOWER' : 'MIXED';
}

/** Why a seller could dismiss an anchor — shown as a badge with the reason on hover. */
export const ANCHOR_FLAG_LABELS: Record<string, { label: string; why: string }> = {
  GROWTH_GAP: { label: 'Growth differs', why: 'Its ARR growth is more than 15 points away from the target’s; the seller will say it is not comparable.' },
  RETENTION_GAP: { label: 'Retention differs', why: 'Its NRR is more than 10 points away from the target’s.' },
  DIFFERENT_COMPANY_TYPE: { label: 'Different sector', why: 'It is a different type of company from the target.' },
  OLDER_THAN_3_YEARS: { label: 'Older than 3 years', why: 'Announced more than three years ago, in a different market.' },
  REVENUE_NOT_ARR: { label: 'Revenue, not ARR', why: 'The disclosed figure is total revenue; an ARR multiple would be higher.' },
  NO_PUBLIC_SOURCE: { label: 'No public link', why: 'There is no source link the seller can check.' },
  SYNTHETIC: { label: 'Demo data', why: 'Invented for demos — never cite it.' },
  SUPPORTS_ASK: { label: 'Supports the ask', why: 'At this multiple the target is worth at least the asking price — it argues for the seller.' },
  CURRENCY: { label: 'Other currency', why: 'Its figures are in another currency; the multiple still applies, but check the market.' },
};
