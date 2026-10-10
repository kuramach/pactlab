import type { ReactNode } from 'react';
import { cn } from '../utils';

/**
 * Plain-language expansions for every abbreviation the product shows. Kept in
 * one place so each term reads the same everywhere.
 */
export const GLOSSARY: Readonly<Record<string, string>> = {
  ARR: 'Annual recurring revenue — recurring subscription revenue for a year (MRR × 12).',
  MRR: 'Monthly recurring revenue — subscription revenue billed each month, excluding one-off charges.',
  ARPA: 'Average revenue per account — MRR divided by the number of paying customers.',
  ARPU: 'Average revenue per user — recurring revenue divided by the number of users.',
  ACV: 'Annual contract value — the yearly value of a customer contract.',
  CAC: 'Customer acquisition cost — sales and marketing spend to win one new customer.',
  LTV: 'Customer lifetime value — the gross profit a customer brings over their whole relationship.',
  FX: 'Foreign exchange — converting between currencies at a recorded rate.',
  NRR: 'Net revenue retention — revenue kept from existing customers after upgrades, downgrades and churn.',
  GRR: 'Gross revenue retention — revenue kept from existing customers before any upgrades.',
  EV: 'Enterprise value — the value of the whole business, before cash and debt.',
  DCF: 'Discounted cash flow — values a business from its future cash flows, discounted to today.',
  LBO: 'Leveraged buyout — an acquisition funded largely with debt, typical of private-equity take-privates.',
  MOIC: 'Multiple on invested capital — how many times the equity invested comes back at exit.',
  IRR: 'Internal rate of return — the annualised return on the equity invested.',
  EBITDA: 'Earnings before interest, taxes, depreciation and amortisation — a proxy for operating cash profit.',
  FCF: 'Free cash flow — cash left after operating costs and investment.',
  EPS: 'Earnings per share.',
  LOI: 'Letter of intent — a non-binding offer that sets out the main deal terms.',
  KPI: 'Key performance indicator.',
  SaaS: 'Software as a service — software sold by subscription.',
  'M&A': 'Mergers and acquisitions.',
  SBOM: 'Software bill of materials — the list of components and licences inside the code.',
  OSS: 'Open-source software.',
  CSV: 'Comma-separated values — a spreadsheet export format.',
  API: 'Application programming interface — a direct, automated connection to another system.',
  SSO: 'Single sign-on — signing in with your company account.',
  AI: 'Artificial intelligence — here, Claude drafting cited findings for human review.',
  AWS: 'Amazon Web Services — the cloud platform Pactlab runs on.',
  NDA: 'Non-disclosure agreement — a contract to keep shared information confidential.',
  HR: 'Human resources — employee, pay and performance information.',
  UTC: 'Coordinated Universal Time — the time standard used for every timestamp.',
  VDR: 'Virtual data room — the secure site where a seller shares documents.',
  ESOP: 'Employee share ownership plan.',
};

/**
 * An abbreviation with its expansion on hover and keyboard focus. Uses
 * <abbr title> for assistive technology plus a styled tooltip.
 */
export function Term({ term, children, className }: { term: string; children?: ReactNode; className?: string }) {
  const meaning = GLOSSARY[term];
  if (!meaning) return <>{children ?? term}</>;
  return (
    <span className={cn('group/term relative inline-block', className)}>
      <abbr
        title={meaning}
        tabIndex={0}
        className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline focus:underline focus:outline-none"
      >
        {children ?? term}
      </abbr>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden w-64 -translate-x-1/2 rounded-lg bg-navy px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-xl group-hover/term:block group-focus-within/term:block"
      >
        <span className="font-bold text-indigo">{term}</span> · {meaning}
      </span>
    </span>
  );
}

const PATTERN = new RegExp(
  `(?<![A-Za-z])(${Object.keys(GLOSSARY)
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[&]/g, '\\&'))
    .join('|')})(?![A-Za-z])`,
  'g',
);

/** Text with every known abbreviation explained on hover. */
export function Glossed({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(<Term key={`${index}-${match[0]}`} term={match[0]} />);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/**
 * Explain abbreviations in plain text children; anything else passes through
 * unchanged. Lets shared components gloss whatever text they are given.
 */
export function gloss(node: ReactNode): ReactNode {
  if (typeof node === 'string') return <Glossed text={node} />;
  if (Array.isArray(node)) return node.map((child, index) => (typeof child === 'string' ? <Glossed key={index} text={child} /> : child));
  return node;
}
