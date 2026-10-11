import { cn } from '../utils';
import { gloss } from './term';

/** Brand kit (`brand/BRAND.md`); the tagline matches the website. */
export const PACTLAB_TAGLINE = 'AI rigor. Human judgment.';
export const PACTLAB_PROMISE = 'Test the pact before you sign it.';
export const PACTLAB_PILLAR = 'AI diligence. Human instinct.';

/** Logo files from `brand/logos`, served by the host app under `/brand`. */
const LOGO = {
  onLight: { src: '/brand/pactlab-logo.png', width: 800, height: 228 },
  onDark: { src: '/brand/pactlab-logo-light.png', width: 800, height: 228 },
  symbol: { src: '/brand/pactlab-symbol.png', width: 256, height: 256 },
} as const;

/**
 * Pactlab wordmark: lowercase "pact" in deep navy, "lab" in indigo, the "b"
 * a flask. `onDark` uses the reversed artwork for navy surfaces.
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

/** Standalone symbol: the pact (handshake) inside the lab flask. */
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
 * Website lockup: symbol, wordmark and tagline together. On navy the symbol
 * sits on a white tile and the reversed wordmark is used.
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
      {tone === 'onDark' ? (
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1">
          <img src={LOGO.symbol.src} alt="" width={LOGO.symbol.width} height={LOGO.symbol.height} className="h-full w-auto" />
        </span>
      ) : (
        <img src={LOGO.symbol.src} alt="" width={LOGO.symbol.width} height={LOGO.symbol.height} className="h-11 w-auto" />
      )}
      <span className="flex flex-col gap-0.5">
        <img
          src={LOGO[tone].src}
          width={LOGO[tone].width}
          height={LOGO[tone].height}
          alt="Pactlab"
          className="h-7 w-auto self-start"
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
