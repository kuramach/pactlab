import { cn } from '../utils';

/** The spec tagline (§22). */
export const PACTLAB_TAGLINE = 'Every deal is a pact. Make it an honest one.';

/**
 * Pactlab mark: two interlocking rings on a cobalt tile — two parties bound
 * by one pact. Decorative next to the wordmark, labelled when standalone.
 */
export function PactlabMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('h-8 w-8 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="32" height="32" rx="8" fill="var(--color-primary)" />
      <circle cx="12.75" cy="16" r="6.25" fill="none" stroke="white" strokeWidth="2.5" />
      <circle cx="19.25" cy="16" r="6.25" fill="none" stroke="white" strokeOpacity="0.72" strokeWidth="2.5" />
    </svg>
  );
}

/**
 * Mark plus lowercase wordmark. The name never depends on capitalisation
 * (spec §22), so the wordmark is set lowercase.
 */
export function PactlabLogo({ className, withTagline = false }: { className?: string; withTagline?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <PactlabMark />
      <div className="leading-tight">
        <p className="text-lg font-semibold tracking-tight text-foreground">
          pactlab<span className="sr-only"> (Pactlab)</span>
        </p>
        {withTagline ? <p className="text-xs text-muted-foreground">{PACTLAB_TAGLINE}</p> : null}
      </div>
    </div>
  );
}
