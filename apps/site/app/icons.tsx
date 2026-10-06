import type { JSX } from 'react';

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-6 w-6"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, () => JSX.Element> = {
  hub: () => (
    <Svg>
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="5" cy="5" r="1.6" />
      <circle cx="19" cy="5" r="1.6" />
      <circle cx="5" cy="19" r="1.6" />
      <circle cx="19" cy="19" r="1.6" />
      <path d="M6.2 6.2 10 10M17.8 6.2 14 10M6.2 17.8 10 14M17.8 17.8 14 14" />
    </Svg>
  ),
  chart: () => (
    <Svg>
      <path d="M4 20h16" />
      <rect x="6" y="12" width="3" height="8" rx="0.8" />
      <rect x="11" y="8" width="3" height="12" rx="0.8" />
      <rect x="16" y="4" width="3" height="16" rx="0.8" />
    </Svg>
  ),
  code: () => (
    <Svg>
      <path d="M8 7 3.5 12 8 17M16 7l4.5 5L16 17" />
    </Svg>
  ),
  users: () => (
    <Svg>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.5 14.2c2.9.1 4.6 1.7 5 4.8" />
      <path d="M18.5 3.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  shield: () => (
    <Svg>
      <path d="M12 3l7 2.6v5.2c0 4.6-3 7.6-7 9.2-4-1.6-7-4.6-7-9.2V5.6z" />
      <path d="M9 11.6l2.2 2.2 3.8-4" />
    </Svg>
  ),
  lock: () => (
    <Svg>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
      <circle cx="12" cy="15.2" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  ),
  file: () => (
    <Svg>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 15.5h6M9 19h4" />
    </Svg>
  ),
  database: () => (
    <Svg>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.8" />
      <path d="M5 5.5v13c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9v-13" />
      <path d="M5 12c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9" />
    </Svg>
  ),
  calculator: () => (
    <Svg>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M9 7.5h6" />
      <path d="M9 12h.8M12.6 12h.8M16.2 12h.01M9 15.5h.8M12.6 15.5h.8M16.2 15.5h.01M9 19h.8M12.6 19h4.4" />
    </Svg>
  ),
  bridge: () => (
    <Svg>
      <path d="M3 19h18" />
      <path d="M5 19v-6h14v6" />
      <path d="M5 13l3.5-5L12 13l3.5-5L19 13" />
    </Svg>
  ),
  cloud: () => (
    <Svg>
      <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5 4.2 4.2 0 0 1 17.5 18z" />
      <path d="M9.5 13.5h4M12 11v5" />
    </Svg>
  ),
  clipboard: () => (
    <Svg>
      <rect x="6" y="4.5" width="12" height="16.5" rx="2" />
      <rect x="9.5" y="2.5" width="5" height="3.5" rx="1" />
      <path d="M9.5 13l1.8 1.8 3.2-3.6" />
    </Svg>
  ),
  message: () => (
    <Svg>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </Svg>
  ),
  flag: () => (
    <Svg>
      <path d="M6 21V4" />
      <path d="M6 4.8c4-2.2 7 2.2 12 0v8c-5 2.2-8-2.2-12 0" />
    </Svg>
  ),
  globe: () => (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c-5.5 5-5.5 12 0 17M12 3.5c5.5 5 5.5 12 0 17" />
    </Svg>
  ),
  key: () => (
    <Svg>
      <circle cx="8" cy="12" r="4.5" />
      <path d="M12.5 12H21M18 12v3.5M15 12v2.5" />
    </Svg>
  ),
};

export function FeatureIcon({ name }: { name: string }) {
  const Icon = ICONS[name] ?? ICONS.hub;
  return <Icon />;
}
