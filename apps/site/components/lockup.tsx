import { TAGLINE } from '../lib/content';

/**
 * Brand lockup: the flask-and-handshake symbol beside the wordmark
 * (`brand/logos`), optionally with the tagline under the name. On navy, the
 * navy symbol sits on a white tile so it stays visible, and the reversed
 * wordmark is used.
 */
export function Lockup({
  tone = 'onLight',
  size = 'md',
  withTagline = false,
}: {
  tone?: 'onLight' | 'onDark';
  size?: 'md' | 'sm';
  withTagline?: boolean;
}) {
  const height = size === 'md' ? (withTagline ? 'h-11' : 'h-9') : 'h-7';
  return (
    <span className="inline-flex items-center gap-3">
      {tone === 'onDark' ? (
        <span className={`inline-flex ${height} aspect-square items-center justify-center rounded-lg bg-white p-1`}>
          <img src="/brand/pactlab-symbol.png" alt="" width={512} height={512} className="h-full w-auto" />
        </span>
      ) : (
        <img src="/brand/pactlab-symbol.png" alt="" width={512} height={512} className={`${height} w-auto`} />
      )}
      <span className="flex flex-col gap-0.5">
        <img
          src={tone === 'onDark' ? '/brand/pactlab-logo-light.png' : '/brand/pactlab-logo.png'}
          alt="Pactlab"
          width={800}
          height={228}
          className={size === 'md' ? 'h-7 w-auto self-start' : 'h-5 w-auto self-start'}
        />
        {withTagline ? (
          <span className={`text-[11px] font-semibold tracking-wide ${tone === 'onDark' ? 'text-white/70' : 'text-slate-text'}`}>
            {TAGLINE}
          </span>
        ) : null}
      </span>
    </span>
  );
}
