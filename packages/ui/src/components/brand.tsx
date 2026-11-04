import { cn } from '../utils';
import { gloss } from './term';

/** Brand kit (`brand/BRAND.md`); the tagline matches the website. */
export const PACTLAB_TAGLINE = 'AI rigor. Human judgment.';
export const PACTLAB_PROMISE = 'Test the pact before you sign it.';
export const PACTLAB_PILLAR = 'AI diligence. Human instinct.';

/** Locked B2 brand assets served by the host app under `/brand`. */
const LOGO = {
  onLight: { src: '/brand/pactlab-logo.svg', width: 393, height: 150 },
  onDark: { src: '/brand/pactlab-logo-light.svg', width: 393, height: 150 },
  symbol: { src: '/brand/pactlab-symbol.svg', width: 120, height: 120 },
} as const;

/**
 * Locked Pactlab B2 flask and outlined wordmark for light and dark surfaces.
 */
export function PactlabLogo({
  className,
  tone = 'onLight',
  withTagline = false,
}: {
  className?: string;
  tone?: 'onLight' | 'onDark';
  withTagline?: boolean;
}) {
  const logo = LOGO[tone];
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <img src={logo.src} width={logo.width} height={logo.height} alt="Pactlab" className="h-8 w-auto self-start" />
      {withTagline ? (
        <p className={cn('text-xs', tone === 'onDark' ? 'text-white/80' : 'text-muted-foreground')}>{PACTLAB_TAGLINE}</p>
      ) : null}
    </div>
  );
}

/** Standalone B2 flask symbol. */
export function PactlabSymbol({ className, label }: { className?: string; label?: string }) {
  return (
    <img
      src={LOGO.symbol.src}
      width={LOGO.symbol.width}
      height={LOGO.symbol.height}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      className={cn('h-8 w-8', className)}
    />
  );
}

/**
 * Website lockup: B2 flask and outlined wordmark together with the tagline.
 */
export function PactlabLockup({
  tone = 'onLight',
  withTagline = true,
  className,
}: {
  tone?: 'onLight' | 'onDark';
  withTagline?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <span className="flex flex-col gap-0.5">
        <img
          src={LOGO[tone].src}
          width={LOGO[tone].width}
          height={LOGO[tone].height}
          alt="Pactlab"
          className={cn('w-auto self-start', withTagline ? 'h-8' : 'h-10')}
        />
        {withTagline ? (
          <span className={cn('text-[11px] font-semibold tracking-wide', tone === 'onDark' ? 'text-white/70' : 'text-slate-text')}>
            {gloss(PACTLAB_TAGLINE)}
          </span>
        ) : null}
      </span>
    </span>
  );
}
