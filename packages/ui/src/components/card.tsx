import type { CSSProperties, HTMLAttributes } from 'react';
import { SECTION_ACCENTS, accentFor, type SectionAccent, type SectionKey } from '../section-accents';
import { cn } from '../utils';
import { gloss } from './term';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** A registered section (preferred): its accent comes from the shared registry. */
  section?: SectionKey;
  /** A raw accent, for a section not yet in the registry. */
  accent?: SectionAccent;
};

export function Card({ className, section, accent, style, ...props }: CardProps) {
  const key = accent ?? (section ? accentFor(section) : undefined);
  return (
    <div
      className={cn(
        'rounded-2xl border border-navy/10 bg-card text-card-foreground shadow-sm shadow-navy/5',
        key && 'border-l-4 border-l-[var(--section-accent)] [&>[data-card-header]]:rounded-tr-2xl [&>[data-card-header]]:bg-[color-mix(in_srgb,var(--section-accent)_9%,var(--color-card))]',
        className,
      )}
      style={key ? ({ '--section-accent': SECTION_ACCENTS[key], ...style } as CSSProperties) : style}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-card-header className={cn('flex flex-col gap-1 p-5', className)} {...props} />;
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-base font-bold leading-tight tracking-tight', className)} {...props}>
      {gloss(children)}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)} {...props}>
      {gloss(children)}
    </p>
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}
