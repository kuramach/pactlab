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

export const FEATURE_CARD_ICONS = ['table', 'cloud', 'palette', 'shield', 'lock', 'fingerprint', 'key', 'check', 'layers', 'compass', 'message'] as const;
export type FeatureCardIcon = (typeof FEATURE_CARD_ICONS)[number];

/** How many undismissed cards the home shows at once; the rest queue behind the icon. */
export const HOME_CARD_LIMIT = 2;

export const FEATURE_CARDS: readonly FeatureCardDefinition[] = [
  // What Pactlab stands on (Kumar, 2026-11-25: "lots of features that we need to highlight"): each card says only
  // what the product does today, in the words of the privacy, security and trust pages.
  {
    id: 'aws-security',
    version: 1,
    addedOn: '2026-11-25',
    title: 'Security first, on AWS',
    body: 'Pactlab runs on AWS in the United States. Every organization is kept apart in the database itself, credentials sit in encrypted stores, and code scans run in throwaway workspaces, so source code is never kept.',
    href: '/settings/controls',
    linkLabel: 'See the security controls',
    icon: 'shield',
  },
  {
    id: 'ai-never-keeps-your-data',
    version: 1,
    addedOn: '2026-11-25',
    title: 'AI that never trains on or keeps your data',
    body: 'Models run on Amazon Bedrock inside Pactlab’s AWS account. Your content is never used to train a model, and any other provider an organization switches on works under terms that do not let it keep your content. Names, pay and other people data never reach a model.',
    href: '/settings/ai-models',
    linkLabel: 'See the AI models',
    icon: 'lock',
  },
  {
    id: 'audit-trail',
    version: 1,
    addedOn: '2026-11-25',
    title: 'A tamper-evident audit trail',
    body: 'Sensitive reads, decisions, exports and refusals are written to your organization’s hash-chained, append-only log, so every number and every decision can be traced to who did it and when.',
    href: '/audit',
    linkLabel: 'Open the audit log',
    icon: 'fingerprint',
  },
  {
    id: 'enterprise-sso',
    version: 1,
    addedOn: '2026-11-25',
    title: 'Enterprise single sign-on',
    body: 'Your team can sign in through your company’s identity provider, such as Microsoft Entra ID, Okta or Google Workspace. Ask Pactlab and we set it up for your organization.',
    href: null,
    icon: 'key',
  },
  {
    id: 'humans-decide',
    version: 1,
    addedOn: '2026-11-25',
    title: 'AI drafts, people decide',
    body: 'Every AI finding quotes the page it came from and stays a draft until a named reviewer accepts it. Metrics, prices and valuations come from versioned calculations, never from model text.',
    href: '/findings',
    linkLabel: 'Open Findings',
    icon: 'check',
  },
  {
    id: 'hotels-pack',
    version: 1,
    addedOn: '2026-11-28',
    title: 'Hotels: the franchise, the PIP and the comp set against the claims',
    body: 'On a hotel pact, Pactlab reads the franchise agreement’s term, termination rights and fees against the hold; sets each item of the brand’s property improvement plan against the seller’s capex schedule and prices what falls due in the first year unfunded; checks the deck’s RevPAR, ADR, occupancy and comp-set index claims against the STR benchmark and the operating history; shows what in the management agreement binds a buyer; and reads franchise and brand fees against rooms revenue across the P&L years. Documents, dates and arithmetic only — it never values the flag; a person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a hotel pact',
    icon: 'layers',
  },
  {
    id: 'commercial-property-pack',
    version: 1,
    addedOn: '2026-11-28',
    title: 'Commercial property: the rent roll against the leases, recoveries and the expiry cliff',
    body: 'On a commercial property pact, Pactlab recomputes each tenant’s rent from its lease — initial rent, escalations and term — and flags a rent roll or statement that carries more; sets NNN and CAM recoveries billed against what the leases make recoverable, year by year; lists the tenant improvements, leasing commissions and committed capex the buyer inherits; shows the share of rent expiring in each year of the hold; and reads the property condition assessment against the seller’s capex schedule. Documents and arithmetic only — it never values the property; a person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a commercial property pact',
    icon: 'layers',
  },
  {
    id: 'hospitals-pack',
    version: 1,
    addedOn: '2026-11-27',
    title: 'Hospitals: cost reports, payer contracts, medical staff and the plant, checked against the evidence',
    body: 'On a hospitals pact, Pactlab reconciles occupancy and payer mix in the filed cost reports against the deck and the financial statements, reads each material payer agreement’s rate basis and end date against the expected closing, checks every physician’s licence and privileges and flags a department whose privileges lapse together, sets capex against revenue across every imported P&L year beside the condition assessment, and maps published quality ratings to the reports supplied. Documents, dates and arithmetic only; a person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a hospitals pact',
    icon: 'layers',
  },
  {
    id: 'telecom-media-pack',
    version: 1,
    addedOn: '2026-11-26',
    title: 'Telecom & media: subscriber claims, rights windows and revenue concentration',
    body: 'On a telecom and media pact, Pactlab recomputes subscribers, churn and ARPU from the subscriber movements export and marks the deck’s figures verified, contradicted or unverified, reads every content, affiliate and carriage agreement’s end date against the expected closing and flags a material one ending within twelve months, measures advertising and affiliate revenue by counterparty, and sets content cost per subscriber and capex against ARPU across every imported P&L year. Documents, dates and arithmetic only; a person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a telecom pact',
    icon: 'layers',
  },
  {
    id: 'professional-services-pack',
    version: 1,
    addedOn: '2026-11-26',
    title: 'IT & professional services: utilization, realization and the people the fees depend on',
    body: 'On a professional services pact, Pactlab recomputes fees, realization and collection from the time-and-billing export and reconciles them to the P&L by year, checks the deck’s client and partner concentration ceilings against fees by client and by partner book, reads the covenant register for every rainmaker and flags one with no non-solicit on file, prices WIP and debtor ageing drift into working capital, and records the recurring and project split. Documents and arithmetic only, fee-earners by pseudonymous reference; a person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a services pact',
    icon: 'layers',
  },
  {
    id: 'ecommerce-dtc-pack',
    version: 1,
    addedOn: '2026-11-26',
    title: 'E-commerce & DTC: channel economics, cohort value and platform dependence, from the exports',
    body: 'On an e-commerce and DTC pact, Pactlab recomputes revenue by channel from the storefront and marketplace exports and reconciles it to the P&L by year, recomputes lifetime value on a contribution-margin basis and checks the deck’s LTV and CAC against it, reads who each storefront, marketplace and ad account is registered to and flags a material one held personally, prices stock older than 180 days, and reads acquisition cost and contribution across every imported year. Exports and documents only, never a scrape; a person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start an e-commerce pact',
    icon: 'layers',
  },
  {
    id: 'pharma-biotech-pack',
    version: 1,
    addedOn: '2026-11-26',
    title: 'Pharma & biotech: pipeline claims, patent cliffs and licence obligations, checked against the documents',
    body: 'On a pharma and biotech pact, Pactlab checks each programme’s claimed phase and timeline against the trial-registry records and regulatory correspondence you supply, reads each patent’s expiry against the hold after closing and prices a cliff inside it, recomputes the milestones, royalties and fees in the licence agreements and finds the ones the seller’s model leaves out, flags single-source manufacturing and key-scientist concentration, and sets R&D spend across every imported P&L year against a timeline brought forward. Documents, dates and consistency only; a person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a pharma pact',
    icon: 'layers',
  },
  {
    id: 'small-clinics-pack',
    version: 1,
    addedOn: '2026-11-26',
    title: 'Small clinics: the owner, the referrer and the lease, checked against the evidence',
    body: 'On a small clinics pact, Pactlab reads the healthcare collections, credentials and payer contracts as on a healthcare pact, then recomputes the selling owner’s share of collections by service line, flags a line only the owner delivers, works out how many visits come from each referral source, reads the clinic lease for its end date, renewal option and assignment on a sale, and reads every imported year of the P&L for trends. A person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a clinics pact',
    icon: 'layers',
  },
  {
    id: 'healthcare-services-pack',
    version: 1,
    addedOn: '2026-11-26',
    title: 'Healthcare: payer mix, denials and credentials checked against the evidence',
    body: 'On a healthcare services pact, Pactlab recomputes collections, payer mix, denial rate and days in receivable from the remittance export, checks the deck’s claims against them, reads every clinician’s licence and expiry from the register and the verification documents, flags a clinician carrying a large share of collections with no non-compete on file, and reads every imported year of the P&L for trends. A person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a healthcare pact',
    icon: 'layers',
  },
  {
    id: 'fintech-payments-pack',
    version: 1,
    addedOn: '2026-11-26',
    title: 'Fintech: volume and licences checked against the evidence',
    body: 'On a fintech pact, Pactlab recomputes processed volume, take rate and chargeback and fraud-loss rates from the processor exports, checks the deck’s claims against them, reads each licence’s status and expiry from the register and its documents, and reads every imported year of the P&L for trends. A person decides every finding.',
    href: '/pacts/new',
    linkLabel: 'Start a fintech pact',
    icon: 'layers',
  },
  {
    id: 'industry-packs',
    version: 1,
    addedOn: '2026-11-25',
    title: 'Every pact knows its industry',
    body: 'Software, apartments, fintech, healthcare, music rights and more: each industry brings its own imports, metrics and checks, so diligence asks the questions that matter for that business.',
    href: '/pacts/new',
    linkLabel: 'Start a pact',
    icon: 'layers',
  },
  {
    id: 'deal-making-style',
    version: 1,
    addedOn: '2026-11-25',
    title: 'Price findings in your deal-making style',
    body: 'Choose how Sextant prices what diligence finds for each pact. The seller never sees it, and you can re-evaluate under another style at any time.',
    href: '/pacts/new',
    linkLabel: 'Start a pact',
    icon: 'compass',
  },
  {
    id: 'files-read-with-you',
    version: 1,
    addedOn: '2026-11-25',
    title: 'Pactlab talks you through each file',
    body: 'Before importing a spreadsheet or extracting from a contract, Pactlab says how it read the file and asks what it needs. Afterwards it shows what it picked up, the metrics it worked out and where they show.',
    href: '/deals',
    linkLabel: 'Open a pact',
    icon: 'message',
  },
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
    version: 2,
    addedOn: '2026-11-21',
    title: 'Add a data room from Google Drive or OneDrive',
    body: 'Anyone on a pact can add their own Google Drive or OneDrive by signing in, with no access token to paste. On Google Drive you pick the files with Google’s picker; on OneDrive you choose a folder.',
    href: '/deals',
    linkLabel: 'Open a pact',
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
