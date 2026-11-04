import { TAGLINE } from '../lib/content';

/** Locked B2 flask and outlined wordmark, optionally paired with the tagline. */
export function Lockup({
  tone = 'onLight',
  size = 'md',
  withTagline = false,
}: {
  tone?: 'onLight' | 'onDark';
  size?: 'md' | 'sm';
  withTagline?: boolean;
}) {
  const height = size === 'md' ? (withTagline ? 'h-8' : 'h-10') : 'h-5';
  const width = size === 'md' ? (withTagline ? 'w-[126px]' : 'w-[157px]') : 'w-[79px]';
  return (
    <span className="inline-flex items-center gap-3">
      <span className="flex flex-col gap-0.5">
        <span className={`relative block ${width} ${height} overflow-hidden`}>
          <img
            src={tone === 'onDark' ? '/brand/pactlab-logo-light.svg' : '/brand/pactlab-logo.svg'}
            alt="Pactlab"
            width={393}
            height={150}
            className="absolute left-0 top-[-25%] h-[150%] w-auto max-w-none"
          />
        </span>
        {withTagline ? (
          <span
            className={`text-[11px] font-semibold tracking-wide ${tone === 'onDark' ? 'text-white/70' : 'text-slate-text'}`}
          >
            {TAGLINE}
          </span>
        ) : null}
      </span>
    </span>
  );
}
