import { cn } from '../utils';

/** Brand kit (`brand/BRAND.md`). */
export const PACTLAB_TAGLINE = 'Test the pact before you sign it.';
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
