/**
 * The Pactlab flask (the locked B2 mark, apps/site/public/brand/pactlab-symbol.svg), in motion for Rinse
 * (T-178): the gradient liquid moves gently and vapour curls from the flask's mouth on the launch screen
 * and while a rinse runs — the flask at work on the documents — and settles to still once the set is
 * clean. Vector only; the operating system's reduced-motion setting stops every animation.
 */
export type FlaskState = 'launch' | 'working' | 'clean';

const LABELS: Readonly<Record<FlaskState, string>> = {
  launch: 'Pactlab Rinse',
  working: 'Rinsing your documents',
  clean: 'Your set is clean',
};

const MOTION = `
.rinse-liquid { animation: rinse-wave 3.2s ease-in-out infinite; transform-origin: 60px 80px; }
.rinse-vapour path { fill: none; stroke: #6978ff; stroke-width: 3; stroke-linecap: round; opacity: 0; animation: rinse-curl 2.8s ease-out infinite; }
.rinse-vapour path:nth-child(2) { animation-delay: 0.9s; }
.rinse-vapour path:nth-child(3) { animation-delay: 1.8s; }
@keyframes rinse-wave { 0%, 100% { transform: translateX(-3px); } 50% { transform: translateX(3px); } }
@keyframes rinse-curl { 0% { opacity: 0; transform: translateY(6px); } 30% { opacity: 0.55; } 100% { opacity: 0; transform: translateY(-14px); } }
@media (prefers-reduced-motion: reduce) { .rinse-liquid, .rinse-vapour path { animation: none; } .rinse-vapour { display: none; } }
`;

export function FlaskMark({ state, size = 120 }: { state: FlaskState; size?: number }) {
  const moving = state !== 'clean';
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 -24 120 144" role="img" aria-label={LABELS[state]} data-state={state}>
      <title>{LABELS[state]}</title>
      {moving ? <style>{MOTION}</style> : null}
      <defs>
        <linearGradient id="rinse-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2A3AA8" />
          <stop offset="1" stopColor="#6978FF" />
        </linearGradient>
        <clipPath id="rinse-bulb">
          <circle cx="60" cy="80" r="24.5" />
        </clipPath>
      </defs>
      {moving ? (
        <g className="rinse-vapour" aria-hidden="true">
          <path d="M60 6 C54 0 66 -6 60 -12" />
          <path d="M54 6 C48 -1 58 -7 52 -14" />
          <path d="M66 6 C72 -1 62 -7 68 -14" />
        </g>
      ) : null}
      <path d="M52 20 V54 C42 60 31 67 31 80 a29 29 0 1 0 58 0 C89 67 78 60 68 54 V20" fill="none" stroke="#081127" strokeWidth="6.5" />
      <rect x="43" y="9" width="34" height="11" rx="5.5" fill="#081127" />
      <g clipPath="url(#rinse-bulb)">
        <path className={moving ? 'rinse-liquid' : undefined} d="M27 77 Q40.5 68.5 54 76 T81 77 T95 77 L95 108 L27 108 Z" fill="url(#rinse-gradient)" />
      </g>
    </svg>
  );
}
