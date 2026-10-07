/**
 * Brand lockup: the flask-and-handshake symbol beside the wordmark
 * (`brand/logos`). On navy, the navy symbol sits on a white tile so it stays
 * visible, and the reversed wordmark is used.
 */
export function Lockup({ tone = 'onLight', size = 'md' }: { tone?: 'onLight' | 'onDark'; size?: 'md' | 'sm' }) {
  const height = size === 'md' ? 'h-9' : 'h-7';
  return (
    <span className="inline-flex items-center gap-2.5">
      {tone === 'onDark' ? (
        <span className={`inline-flex ${height} aspect-square items-center justify-center rounded-lg bg-white p-1`}>
          <img src="/brand/pactlab-symbol.png" alt="" width={512} height={512} className="h-full w-auto" />
        </span>
      ) : (
        <img src="/brand/pactlab-symbol.png" alt="" width={512} height={512} className={`${height} w-auto`} />
      )}
      <img
        src={tone === 'onDark' ? '/brand/pactlab-logo-light.png' : '/brand/pactlab-logo.png'}
        alt="Pactlab"
        width={800}
        height={228}
        className={size === 'md' ? 'h-7 w-auto' : 'h-5 w-auto'}
      />
    </span>
  );
}
