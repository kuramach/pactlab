import type { ReactNode } from 'react';
import { cn } from '../utils';

/**
 * Who did this (batch 1): the Pactlab flask with a spark means the AI drafted
 * it; a circled check means a person decided. They appear as a pair so every
 * screen shows what the machine proposed and what a person signed off —
 * "AI rigor. Human judgment." made visible.
 */
export function AiMark({ className, title = 'AI' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={title} data-mark="ai" className={cn('inline-block h-4 w-4 shrink-0', className)}>
      <title>{title}</title>
      <path d="M46 22 V52 C36 58 24 66 24 80 a32 32 0 1 0 64 0 C88 66 76 58 66 52 V22" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" className="text-navy dark:text-white" />
      <rect x="36" y="10" width="40" height="13" rx="6.5" className="fill-navy dark:fill-white" />
      <path d="M28 78 Q42 70 56 77 T86 78 L86 106 L28 106 Z" className="fill-indigo" />
      {/* The spark: a four-point star at the flask's shoulder. */}
      <path d="M98 6 L104 22 L120 28 L104 34 L98 50 L92 34 L76 28 L92 22 Z" className="fill-indigo" />
    </svg>
  );
}

export function HumanMark({ className, title = 'A person decided' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={title} data-mark="human" className={cn('inline-block h-4 w-4 shrink-0 text-teal', className)}>
      <title>{title}</title>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.25" />
      <path d="M7.5 12.5 L10.5 15.5 L16.5 9" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const pill = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold';

/** "AI" with the mark, or a longer label such as "AI draft". */
export function AiBadge({ children = 'AI', className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn(pill, 'border-indigo/40 bg-indigo/10 text-navy', className)}>
      <AiMark className="h-3.5 w-3.5" title="" />
      {children}
    </span>
  );
}

/** A person's decision, with the mark: "Accepted", "Approved", "Adopted". */
export function HumanBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn(pill, 'border-teal/40 bg-teal/10 text-navy', className)}>
      <HumanMark className="h-3.5 w-3.5" title="" />
      {children}
    </span>
  );
}
