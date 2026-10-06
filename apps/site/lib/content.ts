/**
 * Site copy. Brand voice (`brand/BRAND.md`): direct, expert, zero hype. The
 * machine does the diligence; the human makes the call. Claims describe what
 * Pactlab does; nothing here promises a live integration or a customer.
 */
export const TAGLINE = 'Test the pact before you sign it.';
export const PILLAR = 'AI diligence. Human instinct.';
export const STORY = 'A pact is a promise. A lab is where promises get tested.';

export const HERO = {
  eyebrow: 'Diligence for software and SaaS acquisitions',
  title: TAGLINE,
  body:
    'Pactlab reconciles the revenue, reads the code history and the contracts, and prices what it finds. ' +
    'Every number traces back to its source. Every conclusion is signed off by a person.',
};

export const LOOP = {
  title: 'From evidence to deal terms, without losing the thread',
  body: 'Each step keeps a link to the one before it, so a term in the purchase agreement can be traced back to the record that justified it.',
  steps: [
    { name: 'Evidence', detail: 'Billing exports, repositories, delivery data and documents, normalized and hashed.' },
    { name: 'Finding', detail: 'A drafted issue with citations, waiting for a reviewer.' },
    { name: 'Assumption', detail: 'An explicit, versioned input — never a sentence buried in a memo.' },
    { name: 'Scenario', detail: 'ARR-multiple and DCF runs from stored inputs.' },
    { name: 'Deal term', detail: 'Price adjustments, escrows and indemnities tied to accepted risks.' },
    { name: 'Integration action', detail: 'The first hundred days, linked to what diligence found.' },
  ],
} as const;

export interface Feature {
  title: string;
  body: string;
  icon: string;
}

export interface Arc {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  features: Feature[];
}

export const ARCS: Arc[] = [
  {
    id: 'diligence',
    eyebrow: 'Diligence',
    title: 'Know what you are buying',
    body: 'Eight evidence streams, one normalized record. Every finding below points at its source.',
    features: [
      {
        title: 'Deal context hub',
        body: 'Stage, target, team, permissions, tasks, and evidence status in one thin shell. It syncs to your CRM instead of trying to replace it.',
        icon: 'hub',
      },
      {
        title: 'SaaS metrics',
        body: "MRR, ARR, NRR, GRR, churn, cohorts, and customer concentration computed from billing records — CSV or Stripe. Management's ARR is reconciled against transactions, and a reviewer signs off on the difference.",
        icon: 'chart',
      },
      {
        title: 'Technology diligence',
        body: 'Read-only connections to GitHub, GitLab, and Bitbucket. Commit history, code-health indicators, SBOM and license findings — every finding points at the exact commit. Source code is never stored.',
        icon: 'code',
      },
      {
        title: 'Team and key-person risk',
        body: 'Contribution patterns reveal the stars: core architects, domain experts, and single points of failure, grouped where you can see them. Flight risk and concentration feed team-level valuation adjustments.',
        icon: 'users',
      },
      {
        title: 'OSS and IP risk',
        body: 'License exposure hiding in dependencies, surfaced as priced findings with evidence — not a spreadsheet of maybes.',
        icon: 'shield',
      },
      {
        title: 'Security and compliance',
        body: 'Security posture reviewed against the frameworks your acquirers care about, mapped to findings with evidence attached.',
        icon: 'lock',
      },
      {
        title: 'AI contract review',
        body: 'Key terms extracted from contracts with page-level citations. Deviations from your standard positions are flagged for counsel.',
        icon: 'file',
      },
      {
        title: 'Virtual data room',
        body: 'Connect your VDR and evidence flows straight into diligence. No re-uploading, no duplicate sets.',
        icon: 'database',
      },
    ],
  },
  {
    id: 'valuation',
    eyebrow: 'Valuation',
    title: 'Price what you find',
    body: 'Deterministic models from versioned assumptions. Change a risk, reprice the deal.',
    features: [
      {
        title: 'Valuation workbench',
        body: 'ARR-multiple, DCF, trading comps, and LBO models built from versioned assumptions. Sensitivity tables and a purchase-price bridge come standard.',
        icon: 'calculator',
      },
      {
        title: 'Risk to valuation',
        body: 'When a finding is approved, every scenario that depends on it is marked stale until repriced. The bridge shows exactly what each risk costs.',
        icon: 'bridge',
      },
      {
        title: 'Cloud and unit economics',
        body: 'Infrastructure spend tied to unit economics, so hosting costs show up where they belong: in the numbers.',
        icon: 'cloud',
      },
    ],
  },
  {
    id: 'decision',
    eyebrow: 'Decision',
    title: 'Decide with the receipts',
    body: 'Nothing is accepted without evidence. Nothing is priced without a reviewer.',
    features: [
      {
        title: 'Priced risk register',
        body: 'Every risk carries severity, confidence, cost-to-fix, time-to-fix, evidence, and a suggested deal consequence: price adjustment, escrow, or indemnity.',
        icon: 'clipboard',
      },
      {
        title: 'Document AI',
        body: 'Ask questions across the entire data room. Answers arrive with exact-page citations — and a draft without a citation can never be accepted.',
        icon: 'message',
      },
    ],
  },
  {
    id: 'integration',
    eyebrow: 'Integration',
    title: 'Close, then execute',
    body: 'Diligence does not end at signing. Findings become the plan.',
    features: [
      {
        title: 'Post-merger integration',
        body: 'Accepted risks become a 100-day plan, exported to the task system you already use.',
        icon: 'flag',
      },
      {
        title: 'Transaction types',
        body: 'Public acquirer, private acquirer, or take-private. EDGAR ingestion and disclosure-gap analysis for public targets; data-room discovery for private ones.',
        icon: 'globe',
      },
      {
        title: 'Enterprise SSO',
        body: 'Your team signs in with the identity provider you already trust — Microsoft Entra ID, Okta, or Google Workspace. Tenant isolation is enforced in the database itself.',
        icon: 'key',
      },
    ],
  },
];

export interface Demo {
  id: string;
  title: string;
  body: string;
  gif: string;
  poster: string;
  alt: string;
}

export const DEMOS: Demo[] = [
  {
    id: 'git-stars',
    title: 'See who really built it',
    body: 'Connect GitHub, GitLab, or Bitbucket. Pactlab maps contribution patterns into stars, core, supporting — and the flight risks that reprice the deal.',
    gif: '/demos/git-stars.gif',
    poster: '/demos/git-stars.png',
    alt: 'Animation: connecting a version-control tool, then contributors grouping into stars, core, supporting, and flight risk',
  },
  {
    id: 'metrics-flow',
    title: 'Revenue you can reconcile',
    body: "Billing exports become a normalized ledger: MRR you can trace, cohorts you can point at, and management's number reconciled line by line.",
    gif: '/demos/metrics-flow.gif',
    poster: '/demos/metrics-flow.png',
    alt: 'Animation: billing data normalizing into a ledger, then an MRR chart and cohort retention grid',
  },
  {
    id: 'finding-to-valuation',
    title: 'Findings that move the price',
    body: 'Approve a finding and watch the valuation bridge reprice. Dependent scenarios are flagged stale — never silently updated.',
    gif: '/demos/finding-to-valuation.gif',
    poster: '/demos/finding-to-valuation.png',
    alt: 'Animation: a finding being approved, then a valuation bridge adjusting the price downward',
  },
  {
    id: 'document-qa',
    title: 'Ask the data room',
    body: 'Questions answered with exact-page citations. No citation, no accepted finding.',
    gif: '/demos/document-qa.gif',
    poster: '/demos/document-qa.png',
    alt: 'Animation: a document being indexed, a question typed, and an answer appearing with a page citation',
  },
];

export const PRINCIPLES = {
  title: 'Claude assists. People decide.',
  items: [
    'AI extracts, compares and drafts. It never approves a finding, sets a price or makes a legal call.',
    'Money, KPIs and scenarios come from deterministic, versioned calculations — not model prose.',
    'No citation, no accepted finding.',
    "Each acquirer's data is isolated in the database itself, and target contributors see only what is shared with them.",
    'People data stays aggregate by default and is never sent to a model.',
  ],
};

export const CLOSING = {
  title: 'Pilots with acquirers of software companies',
  body: 'We are working with a small number of design partners on live deals. If you buy or invest in software businesses, talk to us.',
};

/** Words the brand never uses (`brand/BRAND.md`, Voice). */
export const BANNED_WORDS = ['revolutionary', 'game-changing', 'game changing', 'supercharge'] as const;
