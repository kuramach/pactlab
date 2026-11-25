/**
 * The feature-card registry (T-155). Adding a card is one entry here: shipped features only, in plain
 * words, never a claim beyond what the feature does. Bump `version` to bring a changed card back to
 * everyone who dismissed the older one.
 */
export interface FeatureCardDefinition {
  /** Lowercase letters, digits and dashes; the key a person's dismissal is stored under. */
  id: string;
  /** Starts at 1. A higher version than the one a person dismissed puts the card back on their home. */
  version: number;
  /** When it shipped (YYYY-MM-DD): newest first. */
  addedOn: string;
  title: string;
  body: string;
  /** An app path (starts with a single "/"), or null. */
  href: string | null;
  linkLabel?: string;
  /** One of the web app's icon keys. */
  icon: FeatureCardIcon;
}

export const FEATURE_CARD_ICONS = ['table', 'cloud', 'palette'] as const;
export type FeatureCardIcon = (typeof FEATURE_CARD_ICONS)[number];

/** How many undismissed cards the home shows at once; the rest queue behind the icon. */
export const HOME_CARD_LIMIT = 2;

export const FEATURE_CARDS: readonly FeatureCardDefinition[] = [
  {
    id: 'import-mapping-assistant',
    version: 1,
    addedOn: '2026-11-21',
    title: 'Import real spreadsheets with an assistant that asks when unsure',
    body: 'Upload a rent roll, P&L or T-12 as the seller sent it. The assistant proposes the header row, the layout and the column for each field, and asks about anything it is not sure of. You confirm every field before anything is imported.',
    href: '/deals',
    linkLabel: 'Open a pact to import',
    icon: 'table',
  },
  {
    id: 'document-sources-oauth',
    version: 1,
    addedOn: '2026-11-21',
    title: 'Connect Google Drive or OneDrive by signing in',
    body: 'An owner or admin signs in to Google Drive or OneDrive / SharePoint once for the organization, with no access token to paste or renew. Pacts can then read documents from folders you choose.',
    href: '/settings',
    linkLabel: 'Open Settings',
    icon: 'cloud',
  },
  {
    id: 'organization-brand-kit',
    version: 1,
    addedOn: '2026-11-13',
    title: 'Pactlab in your organization’s logo and colors',
    body: 'Add your website and Pactlab drafts a logo, accent color and font from it. An admin reviews and edits the draft before anything changes.',
    href: '/settings',
    linkLabel: 'Open Settings',
    icon: 'palette',
  },
];

export interface FeatureCardView {
  id: string;
  version: number;
  title: string;
  body: string;
  href: string | null;
  linkLabel: string | null;
  icon: FeatureCardIcon;
  /** Behind the icon because the home is full (QUEUED), or dismissed (DISMISSED). Absent on the home. */
  where: 'HOME' | 'QUEUED' | 'DISMISSED';
  /** Not yet read from the icon (always false on the home). */
  unread: boolean;
}

export interface FeatureCardsView {
  homeLimit: number;
  /** At most `homeLimit` undismissed cards, newest first. */
  home: FeatureCardView[];
  /** Everything else, newest first: queued then dismissed by date. */
  tray: FeatureCardView[];
  /** Tray cards not yet read. */
  unread: number;
}

export interface FeatureCardState {
  dismissedVersion: number;
  readVersion: number;
}

/** Newest first, then by id so the order is stable. */
const newestFirst = (a: FeatureCardDefinition, b: FeatureCardDefinition) => (a.addedOn === b.addedOn ? a.id.localeCompare(b.id) : a.addedOn < b.addedOn ? 1 : -1);

/** What one person sees: pure, so the rules are tested without a database. */
export function arrangeFeatureCards(
  cards: readonly FeatureCardDefinition[],
  states: ReadonlyMap<string, FeatureCardState>,
  homeLimit = HOME_CARD_LIMIT,
): FeatureCardsView {
  const view = (card: FeatureCardDefinition, where: FeatureCardView['where']): FeatureCardView => ({
    id: card.id,
    version: card.version,
    title: card.title,
    body: card.body,
    href: card.href,
    linkLabel: card.linkLabel ?? null,
    icon: card.icon,
    where,
    unread: where !== 'HOME' && (states.get(card.id)?.readVersion ?? 0) < card.version,
  });
  const sorted = [...cards].sort(newestFirst);
  const dismissed = (card: FeatureCardDefinition) => (states.get(card.id)?.dismissedVersion ?? 0) >= card.version;
  const open = sorted.filter((card) => !dismissed(card));
  const home = open.slice(0, homeLimit).map((card) => view(card, 'HOME'));
  const queued = new Set(open.slice(homeLimit).map((card) => card.id));
  const tray = sorted.filter((card) => queued.has(card.id) || dismissed(card)).map((card) => view(card, queued.has(card.id) ? 'QUEUED' : 'DISMISSED'));
  return { homeLimit, home, tray, unread: tray.filter((card) => card.unread).length };
}
