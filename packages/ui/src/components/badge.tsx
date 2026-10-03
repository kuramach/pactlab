import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../utils';

/**
 * Provenance badges keep the product contract visible: source evidence,
 * deterministic calculations, model drafts and human-reviewed decisions
 * must never look alike.
 */
export const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      neutral: 'border-border bg-muted text-foreground',
      evidence: 'border-sky-200 bg-sky-50 text-sky-800',
      calculation: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      draft: 'border-amber-200 bg-amber-50 text-amber-900',
      reviewed: 'border-violet-200 bg-violet-50 text-violet-800',
      danger: 'border-red-200 bg-red-50 text-red-800',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
