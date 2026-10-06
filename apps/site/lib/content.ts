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

export const CAPABILITIES = [
  {
    title: 'Revenue you can reconcile',
    body:
      'MRR, ARR, retention, cohorts and customer concentration computed from billing records. ' +
      "Management's ARR is reconciled to transactions, and a reviewer approves the difference.",
  },
  {
    title: 'Code and delivery, read rather than guessed',
    body:
      'Commit history, key-person concentration, unattributed commits and licence exposure, plus delivery trends from issue trackers. ' +
      'Findings point to the exact commit and tool version. Source code is never stored.',
  },
  {
    title: 'Documents with exact citations',
    body:
      'Contract terms extracted with page-level citations. A model can draft a finding; without a citation that resolves, it cannot be accepted.',
  },
  {
    title: 'Valuation that stays honest',
    body:
      'Scenarios, sensitivities and a purchase-price bridge built from versioned assumptions. Change an accepted risk and every scenario that depends on it is marked stale.',
  },
] as const;

export const PRINCIPLES = {
  title: 'Claude assists. People decide.',
  items: [
    'AI extracts, compares and drafts. It never approves a finding, sets a price or makes a legal call.',
    'Money, KPIs and scenarios come from deterministic, versioned calculations — not model prose.',
    'No citation, no accepted finding.',
    "Each acquirer's data is isolated in the database itself, and target contributors see only what is shared with them.",
    'People data stays aggregate by default and is never sent to a model.',
  ],
} as const;

export const CLOSING = {
  title: 'Pilots with acquirers of software companies',
  body: 'We are working with a small number of design partners on live deals. If you buy or invest in software businesses, talk to us.',
};

/** Words the brand never uses (`brand/BRAND.md`, Voice). */
export const BANNED_WORDS = ['revolutionary', 'game-changing', 'game changing', 'supercharge'] as const;
