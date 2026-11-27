import { useId } from 'react';

/**
 * The chat icon (T-186, approved by Kumar 2026-11-27): the Pactlab flask as a speaking face in profile, smoke
 * curling from its mouth. One drawing, facing right as designed (docs/brand/chat-icon.webp). Orientation follows
 * placement, never an ad-hoc flip: a chat button on the right of the page looks left, into the page; one on the
 * left looks right. `compact` is the simplified drawing for 24 px and below (heavier strokes, no brow or highlight).
 */
export type ChatMarkPlacement = 'left' | 'right';

export function chatMarkFacing(placement: ChatMarkPlacement): 'left' | 'right' {
  return placement === 'right' ? 'left' : 'right';
}

const NAVY = '#081127';

export function ChatMark({ placement, compact = false, className, title = '' }: { placement: ChatMarkPlacement; compact?: boolean; className?: string; title?: string }) {
  const id = useId();
  const clip = `${id}-body`;
  const liquid = `${id}-liquid`;
  const facing = chatMarkFacing(placement);
  const line = compact ? 6 : 4.5;
  const body = 'M65 64 A45.5 45.5 0 1 0 122 124 Q114 122 113 116 L115 113 L124 109 L121.5 102 L117.5 99 L123 94 C128 91 126 88 123 87 L110 74 C103 67 97 64 94.5 64';
  return (
    <svg
      viewBox="4 2 155 155"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
      data-mark="chat"
      data-facing={facing}
      className={className ?? 'inline-block h-6 w-6 shrink-0'}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={liquid} x1="0.1" y1="1" x2="0.9" y2="0">
          <stop offset="0" stopColor="#2A3AA8" />
          <stop offset="1" stopColor="#6978FF" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={`${body} Z`} />
        </clipPath>
      </defs>
      {/* Drawn facing right; mirrored about its centre line for a left-facing placement. */}
      <g transform={facing === 'left' ? 'translate(163 0) scale(-1 1)' : undefined}>
        <g fill="none" stroke="#6978FF" strokeOpacity="0.6" strokeWidth={compact ? 5 : 3.5} strokeLinecap="round">
          <path d="M79 33 C73 24 85 19 82 11 C80 5 74 7 75 11" />
          <path d="M68 33 C68 24 74 22 70 18 C66 15 61 19 64 22" />
          <path d="M89 33 C87 26 96 22 92 17 C89 13 85 17 88 20" />
        </g>
        <path d={`${body} Z`} fill="#DDE3FF" />
        <path d="M20 91 C50 87 68 96 90 97 C105 97 115 95 135 91 V160 H20 Z" fill={`url(#${liquid})`} clipPath={`url(#${clip})`} />
        <rect x="60" y="36.5" width="39.5" height="11" rx="5.5" fill="#DDE3FF" stroke={NAVY} strokeWidth={line} strokeLinejoin="round" />
        <path d={`M65 47 V64 M94.5 47 V64`} fill="none" stroke={NAVY} strokeWidth={line} strokeLinecap="round" />
        <path d={body} fill="none" stroke={NAVY} strokeWidth={line} strokeLinejoin="round" />
        {/* The open mouth. */}
        <path d="M96 111 C106 113 112 111 115 113 C112 117 113 122 115.5 125 C106 123 100 118 96 111 Z" fill={NAVY} stroke={NAVY} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="100" cy="86" r={compact ? 5 : 4.5} fill="#FFFFFF" stroke={NAVY} strokeWidth={compact ? 3 : 2} />
        <circle cx="101" cy="86.5" r="2.6" fill={NAVY} />
        {compact ? null : (
          <>
            <path d="M87 86 C89 78 95 75 99 74.5 C98 77 93 79 87 86 Z" fill={NAVY} />
            <circle cx="102" cy="85" r="0.9" fill="#FFFFFF" />
          </>
        )}
      </g>
    </svg>
  );
}
