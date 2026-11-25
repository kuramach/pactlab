/**
 * Section colour system for long card pages (T-153). Colour is orientation
 * only: every section keeps its visible title, so no meaning rides on colour.
 *
 * Accents are muted and drawn from the brand family (navy/indigo-led). Each is
 * at least 4.5:1 against white, and header tints are mixed into the card
 * surface at under 12%, so navy text on a tinted header stays well above AA in
 * light and dark themes.
 */
export const SECTION_ACCENTS = {
  indigo: '#4a58e8',
  cobalt: '#2f5fb8',
  teal: '#0f766e',
  violet: '#6d4fc2',
  slate: '#475569',
  plum: '#8a4a8f',
  moss: '#4d7c3a',
  bronze: '#9a5b13',
} as const;

export type SectionAccent = keyof typeof SECTION_ACCENTS;

/**
 * One place that says which section is which colour, so a section keeps its
 * colour everywhere it appears. A new section takes the next unused accent
 * (see packages/ui/README-section-accents.md), never a neighbour's.
 */
export const SECTION_REGISTRY = {
  // Settings
  profile: 'indigo',
  guide: 'cobalt',
  'sign-in': 'teal',
  devices: 'violet',
  'connected-apps': 'slate',
  'api-access': 'plum',
  billing: 'moss',
  bugs: 'bronze',
  'deal-style': 'indigo',
  brand: 'cobalt',
  'investment-committee': 'teal',
  signing: 'violet',
  'document-sources': 'slate',
  organization: 'plum',
  administration: 'moss',
  about: 'bronze',
  session: 'indigo',
  // Admin console
  'admin-approvals': 'indigo',
  'admin-organizations': 'cobalt',
  'admin-users': 'teal',
  'admin-health': 'violet',
  'admin-audit': 'slate',
  'admin-bugs': 'plum',
  'admin-promo-codes': 'moss',
  'admin-demos': 'bronze',
  // Settings sub-pages
  'ai-models': 'cobalt',
  controls: 'teal',
  'controls-gaps': 'bronze',
  'bug-reports': 'bronze',
} as const satisfies Record<string, SectionAccent>;

export type SectionKey = keyof typeof SECTION_REGISTRY;

export function accentFor(section: SectionKey): SectionAccent {
  return SECTION_REGISTRY[section];
}
