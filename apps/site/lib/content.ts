/**
 * Site copy. Brand voice (`brand/BRAND.md`): direct, expert, zero hype. The
 * machine does the diligence; the human makes the call. Claims describe what
 * Pactlab does today; industry packs beyond software are labelled planned
 * (spec §19: deferred until the software baseline is proven in pilot).
 */
import type { IconName } from './icons';

export type { IconName };

export const TAGLINE = 'AI rigor. Human judgment.';
export const DESCRIPTOR = 'Diligence for mergers and acquisitions';
export const STORY = 'A pact is a promise. A lab is where promises get tested.';

export interface Feature {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
}

export const HOME = {
  title: TAGLINE,
  eyebrow: DESCRIPTOR,
  body:
    'Pactlab reconciles the revenue, reads the code and delivery history, cites the contracts and prices what it finds. ' +
    'Every number traces back to its source. Every conclusion is signed off by a person.',
};

/** The decision loop, end to end. Identical for every industry. */
export const FLOW: readonly (Feature & { readonly step: string })[] = [
  {
    step: 'Evidence',
    icon: 'Database',
    title: 'Collect the evidence',
    body: 'Billing records, repositories, delivery data and documents — normalized, hashed and kept with their source.',
  },
  {
    step: 'Finding',
    icon: 'FileSearch',
    title: 'Draft the findings',
    body: 'Analysts, scanners and models draft issues that cite the evidence they rest on.',
  },
  {
    step: 'Review',
    icon: 'ClipboardCheck',
    title: 'A person decides',
    body: 'A named reviewer accepts, rejects or asks for support. Nothing is accepted by a machine.',
  },
  {
    step: 'Assumption',
    icon: 'SlidersHorizontal',
    title: 'Price the risk',
    body: 'Accepted risks become explicit, versioned inputs with a price range and a basis.',
  },
  {
    step: 'Valuation',
    icon: 'Scale',
    title: 'Run the numbers',
    body: 'Deterministic scenarios and a purchase-price bridge, run from stored inputs.',
  },
  {
    step: 'Deal terms',
    icon: 'Handshake',
    title: 'Set the terms',
    body: 'Price adjustments, escrows and indemnities, each tied to the risk that justified it.',
  },
];

export interface ProductModule {
  readonly slug: string;
  readonly icon: IconName;
  readonly name: string;
  /** One line for cards and navigation. */
  readonly summary: string;
  /** The question this module answers for a deal team. */
  readonly question: string;
  readonly intro: string;
  readonly features: readonly Feature[];
  /** What the reviewer sees and signs. */
  readonly output: string;
}

export const MODULES: readonly ProductModule[] = [
  {
    slug: 'revenue',
    icon: 'TrendingUp',
    name: 'Revenue and SaaS metrics',
    summary: 'Recurring revenue rebuilt from billing records and reconciled to what management reports.',
    question: 'Is the ARR in the deck the ARR in the ledger?',
    intro:
      'Pactlab rebuilds recurring revenue from invoice lines rather than from the data book, so every metric traces to the transactions behind it.',
    features: [
      { icon: 'Receipt', title: 'Revenue ledger', body: 'MRR and ARR rebuilt from billing records, with currency conversion at recorded rates.' },
      { icon: 'Repeat', title: 'Retention', body: 'Gross and net revenue retention, expansion, contraction, churn and reactivation.' },
      { icon: 'CalendarRange', title: 'Cohorts', body: 'Revenue and logo cohorts by start month, so a strong year cannot hide a weak vintage.' },
      { icon: 'ChartPie', title: 'Concentration', body: 'Share of revenue held by the largest customers, and how it has moved.' },
      { icon: 'ArrowLeftRight', title: 'Reconciliation', body: 'Management ARR set against billed ARR. A reviewer approves the difference, or it stays open.' },
      { icon: 'MessageSquareQuote', title: 'Explanations', body: 'Every figure shows its formula, time basis, inclusion rules and the source rows behind it.' },
    ],
    output: 'A reconciled revenue view with an approved bridge from reported to billed ARR.',
  },
  {
    slug: 'technology',
    icon: 'GitBranch',
    name: 'Technology and code',
    summary: 'Commit history, ownership and licence exposure, read from the repository rather than the interview.',
    question: 'Who really built this, and what comes with it?',
    intro:
      'Pactlab reads commit metadata and scan results, never keeps the source, and ties every technical finding to the exact commit and tool version that produced it.',
    features: [
      { icon: 'GitCommitHorizontal', title: 'Commit provenance', body: 'Every finding resolves to a full commit hash, the tool that produced it and that tool’s version.' },
      { icon: 'Ghost', title: 'Unattributed commits', body: 'Work by identities missing from the identity map, or committed after a recorded departure.' },
      { icon: 'UserRound', title: 'Key-person concentration', body: 'Subsystems that depend on one contributor, reported as aggregates and never as a ranking of people.' },
      { icon: 'FileCode', title: 'Licence exposure', body: 'Components and licences from a software bill of materials, checked against a licence policy.' },
      { icon: 'ShieldCheck', title: 'Scanner findings', body: 'Security and quality signals from isolated, short-lived scans.' },
      { icon: 'Scissors', title: 'Source never kept', body: 'Scan workspaces are destroyed on success, failure, timeout or cancellation. Paths and hashes remain; code does not.' },
    ],
    output: 'Technology findings, each tied to a commit, a tool version and the evidence it cites.',
  },
  {
    slug: 'delivery',
    icon: 'CircleGauge',
    name: 'Delivery health',
    summary: 'Sprint and issue history that shows whether the roadmap is being delivered.',
    question: 'Can this team ship what the plan assumes?',
    intro:
      'Pactlab reads sprints and issues from the delivery tracker and surfaces the trends a roadmap slide leaves out. It reads delivery facts only, not names, comments or descriptions.',
    features: [
      { icon: 'ListChecks', title: 'Completion against commitment', body: 'Points committed and completed, sprint by sprint.' },
      { icon: 'Bug', title: 'Defect backlog', body: 'Open bugs by priority and age, and which way the backlog is moving.' },
      { icon: 'Repeat', title: 'Reopened work', body: 'Fixes that came back — a signal estimates and burndown charts miss.' },
      { icon: 'Hourglass', title: 'Gaps, not guesses', body: 'Unestimated work, open-ended sprints and unreadable projects are reported, never filled in.' },
    ],
    output: 'Delivery trends and source gaps, ready to become findings.',
  },
  {
    slug: 'documents',
    icon: 'FileText',
    name: 'Documents and contracts',
    summary: 'Contract terms extracted with exact, page-level citations.',
    question: 'What did they actually sign?',
    intro:
      'Pactlab extracts parties, dates and clauses from deal documents and answers questions about them. Every statement points to the exact passage it came from.',
    features: [
      { icon: 'Quote', title: 'Exact citations', body: 'Each answer quotes the page it relies on. A claim whose quote cannot be found is rejected.' },
      { icon: 'ScanSearch', title: 'Clause extraction', body: 'Change of control, assignment, termination, exclusivity and other terms, drafted for review.' },
      { icon: 'ShieldAlert', title: 'Injection-aware', body: 'Instructions hidden inside documents are treated as data. Answers that cite them are blocked.' },
      { icon: 'FileLock', title: 'Secure uploads', body: 'Malware-scanned, tenant-scoped storage with retention classes and legal hold.' },
      { icon: 'EyeOff', title: 'AI exclusion', body: 'HR, compensation and performance documents are never sent to a model.' },
    ],
    output: 'Contract findings with exact citations, accepted only by a named reviewer.',
  },
  {
    slug: 'findings',
    icon: 'ClipboardList',
    name: 'Findings and review',
    summary: 'One place where every issue is drafted, evidenced, priced and decided.',
    question: 'Which risks are real, and what are they worth?',
    intro:
      'Analysts, scanners and models can draft findings. Only people decide them. Every decision is recorded with who made it and why.',
    features: [
      { icon: 'Link2', title: 'Evidence links', body: 'A finding cannot be accepted until its evidence resolves to a source record.' },
      { icon: 'CircleDollarSign', title: 'Priced risk', body: 'Price reductions, escrows, indemnities and remediation costs as decimal ranges with a stated basis.' },
      { icon: 'BadgeCheck', title: 'Human decisions', body: 'Submit, accept, reject or ask for support — each with a rationale and a named reviewer.' },
      { icon: 'Clock', title: 'Append-only history', body: 'Reviews and earlier evidence are never overwritten, so the decision trail stays complete.' },
    ],
    output: 'A register of accepted, priced risks that feeds valuation.',
  },
  {
    slug: 'valuation',
    icon: 'Calculator',
    name: 'Sextant: valuation and deal terms',
    summary: 'Sextant turns accepted risks into scenarios and a purchase-price bridge, frozen when submitted and approved by a second person.',
    question: 'What should we pay, and on what terms?',
    intro:
      'Sextant, Pactlab’s instrument for smart M&A, turns accepted risks into explicit adjustments and runs deterministic valuation scenarios. Change a risk and every scenario that depends on it is marked stale.',
    features: [
      { icon: 'ChartLine', title: 'Methods', body: 'ARR multiples and discounted cash flow, with LBO returns for take-private deals.' },
      { icon: 'Grid3x3', title: 'Sensitivities', body: 'Two-way tables on the inputs that move value most.' },
      { icon: 'Landmark', title: 'Purchase-price bridge', body: 'From enterprise value to equity price: cash, debt, debt-like items, working capital and risk adjustments.' },
      { icon: 'Timer', title: 'Stale on change', body: 'Re-price or reject an accepted risk and dependent results are flagged until they are re-run.' },
      { icon: 'Snowflake', title: 'Frozen submissions', body: 'A submitted scenario is stored byte for byte with its digest and never rewritten.' },
      { icon: 'Stamp', title: 'Four eyes', body: 'The person who submits a valuation cannot approve it.' },
    ],
    output: 'An approved, frozen valuation whose every adjustment traces to an accepted finding.',
  },
];

export const PRINCIPLES = {
  title: 'Claude assists. People decide.',
  body: 'Pactlab uses Claude to read, compare and draft. The decisions stay with the deal team.',
  items: [
    { icon: 'BadgeCheck', title: 'Humans decide', body: 'AI extracts, compares and drafts. It never approves a finding, sets a price or makes a legal call.' },
    { icon: 'Calculator', title: 'Deterministic numbers', body: 'Money, KPIs and scenarios come from versioned calculations and decimal arithmetic, not model prose.' },
    { icon: 'Quote', title: 'Citations required', body: 'No citation that resolves, no accepted finding.' },
    { icon: 'Users', title: 'People data protected', body: 'Aggregate by default. HR, compensation and performance data never reach a model.' },
  ],
} as const satisfies { title: string; body: string; items: readonly Feature[] };

export const TRUST = {
  title: 'Built for confidential deals',
  intro:
    'Diligence data is among the most sensitive a company holds. Pactlab enforces its controls in the database and on the server, not in the interface.',
  items: [
    { icon: 'Lock', title: 'Tenant isolation in the database', body: 'Row-level security scopes every query to one organization and the deals a person belongs to.' },
    { icon: 'EyeOff', title: 'Target boundary', body: 'People from the company being acquired see only what the buyer chooses to share.' },
    { icon: 'Scissors', title: 'No source code retained', body: 'Repositories are scanned in short-lived workspaces that are destroyed afterwards.' },
    { icon: 'FingerprintPattern', title: 'Tamper-evident audit trail', body: 'Sensitive reads, decisions and exports are recorded in a hash-chained, append-only log.' },
    { icon: 'KeyRound', title: 'Your sign-in, your choice', body: 'Each organization signs in through its identity provider or with one-time email codes.' },
    { icon: 'Users', title: 'People data protected', body: 'Aggregate by default; named and compensation data gated, audited and kept away from models.' },
  ],
} as const satisfies { title: string; intro: string; items: readonly Feature[] };

export const SOURCES = {
  title: 'Reads the systems the deal depends on',
  body: 'Each source connects through an adapter with the same contract, and every record keeps its link to where it came from.',
  items: [
    { icon: 'Receipt', title: 'Billing', body: 'Invoice lines, customers and exchange rates.' },
    { icon: 'GitBranch', title: 'Code', body: 'Commit history, identity maps and scan results.' },
    { icon: 'CircleGauge', title: 'Delivery', body: 'Sprints and issues from the delivery tracker.' },
    { icon: 'FileText', title: 'Documents', body: 'Contracts and data-room files.' },
    { icon: 'ChartLine', title: 'Management reporting', body: 'The KPIs and ARR the seller reports.' },
  ],
} as const satisfies { title: string; body: string; items: readonly Feature[] };

export const PILOT = {
  title: 'Pilots with acquirers of software companies',
  body: 'We are working with a small number of design partners on live deals. If you buy or invest in software businesses, talk to us.',
  includes: [
    { icon: 'Building', title: 'One live deal', body: 'Pactlab runs alongside your existing diligence on a real target.' },
    { icon: 'Layers', title: 'Your sources', body: 'Billing, code, delivery and documents connected for that deal.' },
    { icon: 'ClipboardCheck', title: 'Your reviewers', body: 'Your team reviews the findings and approves the valuation.' },
    { icon: 'Mail', title: 'Direct line', body: 'You work with the people building the product.' },
  ],
} as const satisfies { title: string; body: string; includes: readonly Feature[] };

/* ------------------------------------------------------------------------ */
/* Industries                                                                */
/* ------------------------------------------------------------------------ */

export type IndustryStatus = 'AVAILABLE' | 'PLANNED';

export interface Industry {
  readonly slug: string;
  readonly icon: IconName;
  readonly name: string;
  readonly status: IndustryStatus;
  /** Sequencing among planned packs (spec §19); null for the baseline. */
  readonly order: number | null;
  readonly summary: string;
  /** The typical deal and buyer. */
  readonly dealShape: string;
  /** The questions a deal team needs answered. */
  readonly questions: readonly string[];
  /** What the core already handles for this industry. */
  readonly transfers: readonly Feature[];
  /** What the industry pack adds on top of the core. */
  readonly adds: readonly Feature[];
  /** Industry terms mapped onto Pactlab concepts, where the mapping is direct. */
  readonly vocabulary?: readonly { readonly theirs: string; readonly ours: string }[];
}

export const INDUSTRY_CORE = {
  title: 'One core, every industry',
  body:
    'The decision loop never changes: evidence, finding, review, assumption, valuation, deal terms. ' +
    'An industry pack adds only three things — the sources it reads, the findings those sources can produce, and the valuation adjustments the sector needs. ' +
    'Reviewer workflow, citations, tenant isolation and deterministic calculation stay exactly the same.',
  parts: [
    { icon: 'Database', title: 'Evidence adapters', body: 'Read the systems that matter in the sector, through the same adapter contract.' },
    { icon: 'FileSearch', title: 'Finding types', body: 'The sector’s risks, drafted with citations and decided by people.' },
    { icon: 'SlidersHorizontal', title: 'Valuation adjustments', body: 'Sector inputs and sensitivities plugged into the same scenario engine.' },
  ],
} as const satisfies { title: string; body: string; parts: readonly Feature[] };

export const PLANNED_NOTE =
  'Planned. Industry packs are built only after the software baseline is proven with pilot customers, in the order shown. A design partner in this sector can help shape the pack.';

export const INDUSTRIES: readonly Industry[] = [
  {
    slug: 'software-saas',
    icon: 'AppWindow',
    name: 'Software and SaaS',
    status: 'AVAILABLE',
    order: null,
    summary: 'The baseline: recurring revenue, code, delivery, contracts and valuation for software acquisitions.',
    dealShape: 'Strategic and private-equity acquisitions of software and SaaS companies, from tuck-ins to take-privates.',
    questions: [
      'Does billed revenue support the ARR management reports?',
      'How sticky is revenue by cohort, and how concentrated is it?',
      'Who wrote the code, and does the business depend on one person?',
      'What licence and security exposure ships with the product?',
      'Can the team deliver the roadmap the plan assumes?',
      'Which contract terms change at closing?',
    ],
    transfers: [
      { icon: 'TrendingUp', title: 'Revenue and SaaS metrics', body: 'MRR, ARR, retention, cohorts, concentration and reconciliation.' },
      { icon: 'GitBranch', title: 'Technology and code', body: 'Commit provenance, key-person risk, licence exposure and scans.' },
      { icon: 'CircleGauge', title: 'Delivery health', body: 'Completion against commitment, defect backlog and reopened work.' },
      { icon: 'FileText', title: 'Documents and contracts', body: 'Clause extraction and Q&A with exact citations.' },
      { icon: 'Calculator', title: 'Valuation and deal terms', body: 'ARR-multiple, DCF and LBO scenarios with a purchase-price bridge.' },
    ],
    adds: [],
  },
  {
    slug: 'fintech',
    icon: 'Banknote',
    name: 'Fintech',
    status: 'PLANNED',
    order: 1,
    summary: 'Technology companies first, regulated financial businesses second — the shortest step from the software baseline.',
    dealShape: 'Acquisitions of payments, lending, banking-software and embedded-finance companies, often by strategic buyers and growth equity.',
    questions: [
      'Is the compliance programme as strong as the deck says?',
      'How exposed is the business to its banking regulators?',
      'What is the real quality of the loan book, and is the allowance adequate?',
      'Does security hold up to the scrutiny regulators will apply?',
    ],
    transfers: [
      { icon: 'GitBranch', title: 'Technology diligence', body: 'Fintech targets are technology companies; the code and delivery path is the baseline path.' },
      { icon: 'ShieldCheck', title: 'Security and compliance', body: 'Security posture and compliance findings carry over almost one to one.' },
      { icon: 'FileCode', title: 'Open-source and IP risk', body: 'Licence and ownership analysis applies unchanged.' },
      { icon: 'FileText', title: 'Contract review', body: 'Partner bank, processor and customer agreements with exact citations.' },
    ],
    adds: [
      { icon: 'Landmark', title: 'Regulatory exposure', body: 'Findings tied to banking regulators such as the OCC, FDIC and Federal Reserve.' },
      { icon: 'ShieldAlert', title: 'BSA/AML programme', body: 'Review of anti-money-laundering controls as evidence-backed findings.' },
      { icon: 'Wallet', title: 'Loan-book quality', body: 'Credit quality and allowance analysis from loan-level evidence.' },
      { icon: 'Coins', title: 'Capital and credit adjustments', body: 'Regulatory-capital and credit-quality adjustments in the valuation.' },
    ],
  },
  {
    slug: 'healthcare',
    icon: 'HeartPulse',
    name: 'Healthcare services and healthtech',
    status: 'PLANNED',
    order: 2,
    summary: 'Roll-ups of practices and clinics, and healthtech software, where reimbursement and regulatory risk decide the price.',
    dealShape: 'Private-equity roll-ups of practices, clinics and payer-adjacent services; healthtech software targets follow the baseline path.',
    questions: [
      'How dependent is revenue on payer mix and Medicare or Medicaid rates?',
      'Is coding defensible if it is audited?',
      'Are referral relationships clean under Stark Law and anti-kickback rules?',
      'Does the HIPAA privacy and security posture hold up?',
      'Which clinicians does the business depend on?',
    ],
    transfers: [
      { icon: 'ShieldCheck', title: 'Compliance findings', body: 'Regulatory findings use the same evidence, review and citation workflow.' },
      { icon: 'FileText', title: 'Contract review', body: 'Payer, referral and service agreements with exact citations.' },
      { icon: 'UserRound', title: 'Key-person risk', body: 'Dependence on key clinicians, in aggregate.' },
      { icon: 'Building', title: 'Same buyer', body: 'The private-equity deal team is the same buyer the baseline serves.' },
    ],
    adds: [
      { icon: 'Stethoscope', title: 'Reimbursement risk', body: 'Payer mix, coding and government-programme exposure from reimbursement evidence.' },
      { icon: 'Scale', title: 'Stark and anti-kickback', body: 'Referral and compensation arrangements as reviewable findings.' },
      { icon: 'ShieldPlus', title: 'HIPAA posture', body: 'Privacy and security findings mapped to the compliance module.' },
      { icon: 'Percent', title: 'Rate sensitivity', body: 'Payer-mix and reimbursement-rate sensitivities in the valuation.' },
    ],
  },
  {
    slug: 'telecom-media',
    icon: 'RadioTower',
    name: 'Telecom and media',
    status: 'PLANNED',
    order: 3,
    summary: 'Subscriber businesses are recurring-revenue businesses with different labels. The metrics engine already speaks their language.',
    dealShape: 'Acquisitions of subscription media, streaming, connectivity and telecom service providers.',
    questions: [
      'Does subscriber billing support reported ARPU and subscriber counts?',
      'How does churn behave by cohort and by plan?',
      'How concentrated are subscribers or revenue by region or channel?',
    ],
    vocabulary: [
      { theirs: 'ARPU', ours: 'MRR per account' },
      { theirs: 'Subscriber churn', ours: 'Logo churn' },
      { theirs: 'Subscriber cohorts', ours: 'Revenue cohorts' },
    ],
    transfers: [
      { icon: 'TrendingUp', title: 'Metrics engine', body: 'New labels and inclusion rules, not new mathematics.' },
      { icon: 'ChartPie', title: 'Concentration', body: 'Applies directly to subscriber and revenue concentration.' },
      { icon: 'ArrowLeftRight', title: 'Reconciliation', body: 'Reported subscriber metrics reconciled to billing.' },
    ],
    adds: [
      { icon: 'Signal', title: 'Subscriber billing', body: 'Adapters for subscriber-billing systems.' },
      { icon: 'Tv', title: 'Sector definitions', body: 'Subscriber metric definitions with sector inclusion policies.' },
      { icon: 'SlidersHorizontal', title: 'Churn and ARPU inputs', body: 'Churn- and ARPU-driven scenario inputs in the valuation.' },
    ],
  },
  {
    slug: 'professional-services',
    icon: 'Briefcase',
    name: 'IT and professional services',
    status: 'PLANNED',
    order: 4,
    summary: 'Roll-ups of agencies, consultancies and managed-service firms, where the people are the product.',
    dealShape: 'Steady roll-up activity by private equity and strategic acquirers in services businesses.',
    questions: [
      'Are the people billable, and is utilization what management says?',
      'How fast do people leave, and what does the bench cost?',
      'How much revenue sits with the top clients, and on what contract terms?',
    ],
    transfers: [
      { icon: 'ChartPie', title: 'Client concentration', body: 'Top-client revenue share uses the existing concentration analysis.' },
      { icon: 'UserRound', title: 'Key-person risk', body: 'Dependence on senior people, in aggregate and with people-data protections.' },
      { icon: 'FileText', title: 'Contract review', body: 'Master services agreements, durations and termination terms with citations.' },
    ],
    adds: [
      { icon: 'Activity', title: 'Utilization', body: 'Billable utilization from timesheet and PSA evidence.' },
      { icon: 'UserMinus', title: 'Attrition and bench cost', body: 'Attrition and bench findings, reported in aggregate.' },
      { icon: 'Award', title: 'Earnings quality', body: 'Earnings-quality adjustments for people-driven revenue.' },
    ],
  },
  {
    slug: 'pharma-biotech',
    icon: 'Dna',
    name: 'Pharma and biotech',
    status: 'PLANNED',
    order: 5,
    summary: 'The largest deal values and the most specialized diligence: trials, regulators, patents and manufacturing.',
    dealShape: 'Acquisitions and licensing deals for pharmaceutical and biotechnology assets and companies.',
    questions: [
      'What does the clinical evidence actually support?',
      'What is the regulatory path and approval risk with the FDA or EMA?',
      'When do patents and exclusivity expire, and what happens to revenue then?',
      'Does manufacturing meet GMP standards?',
    ],
    transfers: [
      { icon: 'Layers', title: 'Evidence to valuation', body: 'The same evidence, finding, review and valuation skeleton.' },
      { icon: 'Quote', title: 'Document citations', body: 'Exact citations for filings, protocols and agreements.' },
    ],
    adds: [
      { icon: 'Microscope', title: 'Clinical evidence', body: 'Adapters for trial registries and clinical data.' },
      { icon: 'FileCheck', title: 'Regulatory pathway', body: 'FDA and EMA filings and approval risk as findings.' },
      { icon: 'Pill', title: 'Patents and exclusivity', body: 'Patent-cliff and exclusivity analysis from patent data.' },
      { icon: 'ShieldPlus', title: 'Manufacturing quality', body: 'GMP and manufacturing findings.' },
    ],
  },
  {
    slug: 'ecommerce-dtc',
    icon: 'ShoppingCart',
    name: 'E-commerce and DTC',
    status: 'PLANNED',
    order: 6,
    summary: 'Aggregator deals for consumer brands, where unit economics and channel dependence decide value.',
    dealShape: 'Aggregators and roll-ups acquiring consumer and direct-to-consumer brands.',
    questions: [
      'What does it really cost to acquire a customer, and what are they worth?',
      'How often do customers come back?',
      'How dependent is the brand on one marketplace or ad channel?',
    ],
    transfers: [
      { icon: 'CalendarRange', title: 'Cohorts', body: 'Repeat purchase and lifetime value use the cohort machinery.' },
      { icon: 'ChartPie', title: 'Concentration', body: 'Channel and marketplace concentration uses the existing analysis.' },
      { icon: 'FileText', title: 'Contract review', body: 'Marketplace and supplier terms with exact citations.' },
      { icon: 'Calculator', title: 'Valuation', body: 'Valuation methods apply unchanged.' },
    ],
    adds: [
      { icon: 'Store', title: 'Storefront and marketplace data', body: 'Adapters for storefronts and marketplaces.' },
      { icon: 'Megaphone', title: 'Ad-platform spend', body: 'Acquisition cost from ad-platform evidence.' },
      { icon: 'Target', title: 'Unit-economics findings', body: 'CAC, LTV and channel-risk findings.' },
    ],
  },
];

export const NAV = [
  { href: '/product', label: 'Product' },
  { href: '/industries', label: 'Industries' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/trust', label: 'Trust' },
  { href: '/pilot', label: 'Pilot' },
] as const;

/** Words the brand never uses (`brand/BRAND.md`, Voice). */
export const BANNED_WORDS = ['revolutionary', 'game-changing', 'game changing', 'supercharge'] as const;

/** Homepage feature arcs and animated demos (merged from the single-page expansion). */
export const PILLAR = 'AI diligence. Human instinct.';

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

export const CLOSING = {
  title: 'Pilots with acquirers of software companies',
  body: 'We are working with a small number of design partners on live deals. If you buy or invest in software businesses, talk to us.',
};

/** Words the brand never uses (`brand/BRAND.md`, Voice). */

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
        icon: 'Briefcase',
      },
      {
        title: 'SaaS metrics',
        body: "MRR, ARR, NRR, GRR, churn, cohorts, and customer concentration computed from billing records — CSV or Stripe. Management's ARR is reconciled against transactions, and a reviewer signs off on the difference.",
        icon: 'ChartLine',
      },
      {
        title: 'Technology diligence',
        body: 'Read-only connections to GitHub, GitLab, and Bitbucket. Commit history, code-health indicators, SBOM and license findings — every finding points at the exact commit. Source code is never stored.',
        icon: 'GitBranch',
      },
      {
        title: 'Team and key-person risk',
        body: 'Contribution patterns reveal the stars: core architects, domain experts, and single points of failure, grouped where you can see them. Flight risk and concentration feed team-level valuation adjustments.',
        icon: 'Users',
      },
      {
        title: 'OSS and IP risk',
        body: 'License exposure hiding in dependencies, surfaced as priced findings with evidence — not a spreadsheet of maybes.',
        icon: 'ShieldCheck',
      },
      {
        title: 'Security and compliance',
        body: 'Security posture reviewed against the frameworks your acquirers care about, mapped to findings with evidence attached.',
        icon: 'Lock',
      },
      {
        title: 'AI contract review',
        body: 'Key terms extracted from contracts with page-level citations. Deviations from your standard positions are flagged for counsel.',
        icon: 'FileSearch',
      },
      {
        title: 'Virtual data room',
        body: 'Connect your VDR and evidence flows straight into diligence. No re-uploading, no duplicate sets.',
        icon: 'Database',
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
        icon: 'Calculator',
      },
      {
        title: 'Risk to valuation',
        body: 'When a finding is approved, every scenario that depends on it is marked stale until repriced. The bridge shows exactly what each risk costs.',
        icon: 'Scale',
      },
      {
        title: 'Cloud and unit economics',
        body: 'Infrastructure spend tied to unit economics, so hosting costs show up where they belong: in the numbers.',
        icon: 'Coins',
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
        icon: 'ClipboardList',
      },
      {
        title: 'Document AI',
        body: 'Ask questions across the entire data room. Answers arrive with exact-page citations — and a draft without a citation can never be accepted.',
        icon: 'MessageSquareQuote',
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
        icon: 'Target',
      },
      {
        title: 'Transaction types',
        body: 'Public acquirer, private acquirer, or take-private. EDGAR ingestion and disclosure-gap analysis for public targets; data-room discovery for private ones.',
        icon: 'Landmark',
      },
      {
        title: 'Enterprise SSO',
        body: 'Your team signs in with the identity provider you already trust — Microsoft Entra ID, Okta, or Google Workspace. Tenant isolation is enforced in the database itself.',
        icon: 'KeyRound',
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

/** Home page carousel: the four things Pactlab stands for. */
export interface Slide {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly image: string;
  readonly imageAlt: string;
  readonly link: { readonly href: string; readonly label: string };
}

export const CAROUSEL: readonly Slide[] = [
  {
    id: 'rigor',
    eyebrow: 'AI rigor. Human judgment.',
    title: 'The machine does the diligence. You make the call.',
    body:
      'AI rigor means nothing goes unread: every invoice reconciled, every commit traced, every clause cited. ' +
      'Human judgment means nothing is decided for you: a named reviewer accepts each finding and approves the price.',
    points: ['Every invoice, commit and clause read', 'Every claim cited to its source', 'Every decision signed by a person'],
    image: '/illustrations/slide-rigor.svg',
    imageAlt: 'Streams of evidence flowing into a reviewer’s approval check mark',
    link: { href: '/how-it-works', label: 'See how it works' },
  },
  {
    id: 'deal-360',
    eyebrow: 'A 360° view of the deal',
    title: 'Every deal term in one view — including human capital.',
    body:
      'Revenue, code, delivery, contracts, valuation and people, side by side. Key-person risk, retention and ' +
      'compensation harmonization sit next to ARR and the purchase-price bridge, so nothing that drives value is left off the table.',
    points: ['Revenue, code and delivery', 'Contracts and deal terms', 'Human capital: key people, retention and pay'],
    image: '/illustrations/slide-360.svg',
    imageAlt: 'A wheel of six deal areas around the deal: revenue, code, delivery, contracts, valuation and people',
    link: { href: '/product', label: 'Explore the product' },
  },
  {
    id: 'sextant',
    eyebrow: 'Sextant',
    title: 'Sextant: take your bearings before you commit.',
    body:
      'Sextant is Pactlab’s instrument for smart M&A. It turns accepted findings into priced risks, runs ARR-multiple and DCF ' +
      'scenarios from stored inputs, and draws the purchase-price bridge — so you know where you stand and what to pay.',
    points: ['Priced risks from accepted findings', 'Scenarios and sensitivities', 'Purchase-price bridge to the term sheet'],
    image: '/illustrations/slide-sextant.svg',
    imageAlt: 'A sextant measuring the angle between a deal and its price',
    link: { href: '/product/valuation', label: 'Meet Sextant' },
  },
  {
    id: 'security',
    eyebrow: 'Security first. Built on AWS.',
    title: 'Deal data held to the highest standard.',
    body:
      'Pactlab runs on AWS. Every organization is isolated in the database itself, every sensitive read is audited in a ' +
      'tamper-evident trail, credentials stay in encrypted stores, and source code is never kept — scans run in throwaway workspaces.',
    points: ['Tenant isolation enforced in the database', 'Encrypted credentials and audited access', 'Source code never stored'],
    image: '/illustrations/slide-security.svg',
    imageAlt: 'A shield with a lock in front of a cloud',
    link: { href: '/trust', label: 'How we protect deal data' },
  },
];

/** Promotion bar above the header. */
export const ANNOUNCEMENT = {
  text: 'Now onboarding design partners for live deals.',
  link: { href: '/pilot', label: 'Request a pilot' },
};
