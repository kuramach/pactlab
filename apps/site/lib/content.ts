/**
 * Site copy. Brand voice (`brand/BRAND.md`): direct, expert, zero hype. The
 * machine does the diligence; the human makes the call. Claims describe what
 * Pactlab does today; every industry pack is presented as available
 * (founder decision, 2026-10-22: all packs are released together).
 */
import type { IconName } from './icons';

export type { IconName };

export const TAGLINE = 'AI rigor. Human judgment.';
/** Who it is for and what it is (T-120, Kumar 2026-11-11): audience, category and scope, everywhere the positioning appears. */
export const DESCRIPTOR = 'The deal platform for private equity and corporate development';
export const POSITIONING =
  'The deal platform for private equity and corporate development: manage and execute acquisitions end to end, with diligence, valuation, terms and closing in one place.';
export const STORY = 'A pact is a promise. A lab is where promises get tested.';

export interface Feature {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
}

export const HOME = {
  title: TAGLINE,
  eyebrow: 'Deal management and execution for private equity and corporate development',
  body: `${POSITIONING} Every number traces back to its source. Every conclusion is signed off by a person.`,
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
  {
    slug: 'close',
    icon: 'Signature',
    name: 'Two-sided close',
    summary: 'Terms proposed, countered and agreed by both sides in one place, signed through your own DocuSign, with funds confirmed.',
    question: 'Did both sides agree to the same thing?',
    intro:
      'The negotiation and the close happen in the pact, not across email threads. Either side proposes, the other answers, and the version both sides sign is the version the price came from.',
    features: [
      { icon: 'ArrowLeftRight', title: 'Propose and counter', body: 'Buyer or seller proposes a version; the other side accepts, rejects or counters each term, starting with the headline price.' },
      { icon: 'Link2', title: 'Terms tied to risk', body: 'Each escrow, indemnity or price adjustment keeps its link to the finding that justified it.' },
      { icon: 'UserCheck', title: 'Named signatories', body: 'Each side names who signs. Once they sign the current version, the name is fixed.' },
      { icon: 'Signature', title: 'Your own DocuSign', body: 'Envelopes go out from your organization’s DocuSign account, carrying the term sheet Pactlab generated from the agreed version.' },
      { icon: 'Banknote', title: 'Funds confirmed', body: 'The buyer records each payment; the seller reviews and confirms it, or disputes it.' },
      { icon: 'History', title: 'Every version kept', body: 'Every proposal, counter and sign-off stays on record, so the history of the deal is never rewritten.' },
    ],
    output: 'An agreed version signed by both sides, with its term sheet’s fingerprint recorded and the closing checklist confirmed.',
  },
  {
    slug: 'reports',
    icon: 'FileStack',
    name: 'Reports',
    summary: 'An executive view across every deal, and the complete record of one pact as a PDF you can forward.',
    question: 'What do I send the investment committee?',
    intro:
      'Reports turn what the deal team has already reviewed into a document for the people who were not in the room. Each report is a versioned snapshot: generate a new one and the old one stays exactly as it was.',
    features: [
      { icon: 'ChartPie', title: 'Executive report', body: 'Every pact your organization can see, by phase, with priced exposure and the largest open risks, totals traceable to the pacts below them.' },
      { icon: 'FileText', title: 'Pact report', body: 'One pact end to end: evidence, findings with their priced impact, valuation and bridge, terms and the post-close register.' },
      { icon: 'Snowflake', title: 'Versioned snapshots', body: 'Every report is numbered and never rewritten, stamped with when its data was taken and who generated it.' },
      { icon: 'EyeOff', title: 'Your side’s view only', body: 'A report holds only what the person who generated it may see. A seller’s report never shows the buyer’s pricing.' },
      { icon: 'FingerprintPattern', title: 'Audited', body: 'Every generation and every download is recorded in the audit trail.' },
      { icon: 'Download', title: 'Ready to forward', body: 'A paginated PDF with every page marked with its version, its data date and who it is confidential to.' },
    ],
    output: 'A versioned PDF for the committee, the board or the lender, built from reviewed work and never edited after the fact.',
  },
  {
    slug: 'assistant',
    icon: 'MessagesSquare',
    name: 'Pactlab in your AI assistant',
    summary: 'Ask Claude or another MCP-ready assistant about your pacts, with answers drawn from Pactlab and cited to the evidence.',
    question: 'Can I ask about the deal where I already work?',
    intro:
      'Pactlab has an MCP server, so Claude and other assistants that support MCP can read your pacts on your behalf. You sign in to Pactlab once, approve the connection, and the assistant sees exactly what you can see.',
    features: [
      { icon: 'Plug', title: 'Connect in a minute', body: 'Add Pactlab as a connector, sign in, approve. Disconnect any time from Settings.' },
      { icon: 'ClipboardList', title: 'Findings, claims and valuation', body: 'List your deals, read findings and the claims register, and walk through the purchase-price bridge.' },
      { icon: 'Calculator', title: 'What-if scenarios', body: 'Ask what the price looks like under different assumptions. The answer comes from the same calculations, and nothing is saved.' },
      { icon: 'Quote', title: 'Cited answers', body: 'Search the evidence and get answers that point back to the source documents.' },
      { icon: 'Lock', title: 'Your permissions, read-only', body: 'The assistant reads with your access and changes nothing. Confidential value data needs a separate grant.' },
      { icon: 'FingerprintPattern', title: 'Every call audited', body: 'Each tool the assistant uses is recorded, by person, app and deal. Questions and answers are never logged.' },
    ],
    output: 'Answers about your pacts inside the assistant you already use, with Pactlab’s permissions and audit trail behind every one.',
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
    { icon: 'ScanFace', title: 'Passkeys', body: 'Sign in with Face ID, Touch ID, Windows Hello or a security key. Nothing to type, and nothing a phishing page can reuse.' },
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

/**
 * Best-of-breed model routing (T-133, the T-132 capability): copy pinned by Kumar (2026-11-17), verbatim.
 * No benchmark figures, accuracy or speed claims: the claim is the routing, not a score.
 */
export const MODEL_ROUTING = {
  eyebrow: 'Best-of-breed AI',
  title: 'The right model for every document. You never have to choose.',
  body:
    'A data room is agreements, leases, financial statements, scans and charts — and no single AI model is best at all of them. ' +
    'Pactlab routes each job to the frontier model that does it best: one for deep agreement review, another for consistency checks, ' +
    'another for high-volume extraction, another for documents that arrive as images. You don’t pick models, write prompts, or triage ' +
    'documents. Pactlab does — and every finding still arrives with its citation, ready for your review.',
  providers: 'Frontier models from Anthropic, OpenAI and Google — routed per job, swapped as the frontier moves.',
  items: [
    { icon: 'FileSearch', title: 'Deep review', body: 'Frontier reasoning models read agreements end to end, so findings rest on the whole document, not a summary.' },
    { icon: 'ListChecks', title: 'Consistency checks', body: 'A dedicated pass checks defined terms, cross-references and party names across every agreement.' },
    { icon: 'Layers', title: 'Extraction at scale', body: 'High-volume models pull the fields from leases and financials, including scans and tables, without the flagship price.' },
  ],
  howItWorks: {
    title: 'No model shopping',
    body:
      'Most platforms make you choose an AI model and live with its weaknesses. Pactlab routes each kind of work — review, consistency checks, ' +
      'extraction, image documents — to the model that does it best, and re-routes as better models arrive. Your workflow never changes.',
  },
} as const satisfies { eyebrow: string; title: string; body: string; providers: string; items: readonly Feature[]; howItWorks: { title: string; body: string } };

export const PILOT = {
  title: 'Pilots with acquirers of software companies',
  body: 'We are working with a small number of design partners on live deals. If you buy or invest in companies in any of these sectors, talk to us.',
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

/** What a pack adds to the unchanged core: the only three things that vary (spec §19). */
export interface PackDefinition {
  /** Real estate packs form their own cluster; hospitals and clinics extend healthcare services. */
  readonly cluster: 'technology' | 'healthcare' | 'real-estate' | 'services' | 'life-sciences' | 'consumer' | 'capital' | 'media-rights' | 'energy';
  readonly evidence: readonly string[];
  readonly findings: readonly string[];
  readonly valuation: readonly string[];
}

export interface Industry {
  readonly slug: string;
  readonly icon: IconName;
  readonly name: string;
  readonly status: IndustryStatus;
  /** The pack's number in spec §19 and ADR 0008; null for the baseline. */
  readonly order: number | null;
  /** The pack definition (spec §19, ADR 0008); null for the baseline. */
  readonly pack: PackDefinition | null;
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
    pack: null,
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
    status: 'AVAILABLE',
    order: 1,
    pack: {
      cluster: 'technology',
      evidence: ['Processor and bank settlement exports: volume, transactions, net revenue, chargebacks and fraud losses', 'The licence and sponsor-bank register, with the licences and agreements themselves', 'The loan tape and transaction-monitoring alerts', 'Up to five years of the P&L and of the processor exports', 'The deck, the AML procedure, the PCI attestation and exam reports'],
      findings: ['A deck claim for TPV, growth or take rate the processor exports contradict, or that nothing supports', 'A licence or sponsor agreement that has lapsed, or expires within 90 days', 'A quarter’s chargeback or fraud-loss rate over the threshold the sponsor agreement states', 'P&L payments revenue that does not reconcile to the processor exports', 'Fraud losses or another key cost growing faster than revenue across the years', 'A take rate falling, or a loss rate rising, every year across five years', 'An allowance below observed loan losses, and alerts closed without review evidence', 'A PCI attestation more than a year old, or a consent order on file'],
      valuation: ['ARR multiple and DCF, as for any software business', 'Contradicted claims, loss-threshold breaches and lapsed licences as reviewer-priced drags or closing conditions', 'Verified claims recorded as confirmed value only, never as a price increase'],
    },
    summary: 'Payments and lending economics checked against processor and licence evidence, on top of the software baseline.',
    dealShape: 'Acquisitions of payments, lending and embedded-finance companies, often by strategic buyers and growth equity.',
    questions: [
      'Do the processor exports support the TPV, growth and take rate in the deck?',
      'Is every licence and sponsor agreement current, and for how long?',
      'Are chargeback and fraud-loss rates inside the thresholds the sponsor agreement sets?',
      'Is any cost, such as fraud losses, growing faster than revenue year on year?',
      'Is the allowance adequate for the losses on the loan tape?',
    ],
    transfers: [
      { icon: 'GitBranch', title: 'Technology diligence', body: 'Fintech targets are technology companies; the code and delivery path is the baseline path.' },
      { icon: 'TrendingUp', title: 'Revenue and SaaS metrics', body: 'Platform-fee billing runs through the revenue ledger as for any software deal.' },
      { icon: 'FileText', title: 'Contract review', body: 'Partner-bank, processor and customer agreements with exact citations.' },
      { icon: 'Calculator', title: 'Valuation and deal terms', body: 'ARR-multiple and DCF scenarios with accepted findings on the purchase-price bridge.' },
    ],
    adds: [
      { icon: 'ChartLine', title: 'Volume and take rate, recomputed', body: 'Processed volume, transactions and the effective take rate from the processor exports, reconciled to the deck and the P&L.' },
      { icon: 'ClipboardList', title: 'A claims register', body: 'TPV, growth, take-rate and retention claims marked verified, contradicted or unverified against the evidence.' },
      { icon: 'Landmark', title: 'Licences and sponsor agreements', body: 'Each with its status and expiry from the register and the documents; a lapse or near expiry becomes a finding.' },
      { icon: 'ShieldAlert', title: 'Loss rates and compliance evidence', body: 'Chargeback and fraud-loss rates by quarter against stated thresholds; PCI, AML and exam evidence shown as present or absent.' },
      { icon: 'TrendingUp', title: 'Five years of history', body: 'The P&L, volume, take rate and loss rate by year, with how many years each figure rests on; a missing year is asked of the seller.' },
    ],
  },
  {
    slug: 'healthcare',
    icon: 'HeartPulse',
    name: 'Healthcare services and healthtech',
    status: 'AVAILABLE',
    order: 2,
    pack: {
      cluster: 'healthcare',
      evidence: ['Remittance or billing exports by payer: claims, denials, charges, collections and receivables', 'Collections by clinician, by pseudonymous reference', 'The provider roster, the credentialing register and licence verifications', 'The payer contract register, the non-compete and retention schedule, coding audits and the HIPAA risk assessment', 'The P&L for every fiscal year imported, and the deck'],
      findings: ['A deck claim for the denial rate, payer mix or days in receivable the remittances contradict, or that nothing supports', 'A denial rate or days in receivable rising year on year, and a payer mix drifting toward the lowest-paying payer', 'A clinician still collecting after their licence expired, a licence expiring within 90 days, or none on file', 'One clinician carrying a large share of collections with no non-compete or retention agreement on file', 'A payer contract that has ended or ends within a year without renewal', 'P&L patient revenue that does not reconcile to collections, and denial write-offs or another key cost outpacing revenue', 'A medical-director fee above documented duties, and an out-of-date risk assessment or coding audit'],
      valuation: ['DCF, with ARR multiple for healthtech targets', 'Contradicted claims, denial and payer-mix drift and expired licences as reviewer-priced drags or closing conditions', 'Verified claims recorded as confirmed value only, never as a price increase'],
    },
    summary: 'Multi-site provider deals checked against remittances, credentials and contracts: payer mix, denials, credentialing and clinician concentration.',
    dealShape: 'Private-equity roll-ups of practices, clinics and payer-adjacent services; healthtech software targets follow the baseline path.',
    questions: [
      'Do the remittances support the denial rate, payer mix and days in receivable in the deck?',
      'Is the payer mix drifting toward payers that pay less per claim?',
      'Is every clinician’s licence current, and did anyone keep collecting after theirs expired?',
      'Does one clinician carry the collections, and are they bound by a non-compete?',
      'Do the P&L, the payer contracts and the compliance evidence hold up year on year?',
    ],
    transfers: [
      { icon: 'ShieldCheck', title: 'Compliance findings', body: 'Regulatory findings use the same evidence, review and citation workflow.' },
      { icon: 'FileText', title: 'Contract review', body: 'Payer, medical-director and service agreements with exact citations.' },
      { icon: 'UserRound', title: 'Key-person risk', body: 'Dependence on key clinicians, by pseudonymous reference only.' },
      { icon: 'Building', title: 'Same buyer', body: 'The private-equity deal team is the same buyer the baseline serves.' },
    ],
    adds: [
      { icon: 'Stethoscope', title: 'Collections and payer mix, recomputed', body: 'Collections, denial rate, days in receivable and the payer mix from the remittances, reconciled to the deck and the P&L.' },
      { icon: 'ClipboardList', title: 'A claims register', body: 'Denial-rate, payer-share and days-in-receivable claims marked verified, contradicted or unverified against the evidence.' },
      { icon: 'BadgeCheck', title: 'Credentialing, checked', body: 'Every rostered clinician’s licence and expiry from the register and the verification documents; collections after an expiry become a finding.' },
      { icon: 'UserRound', title: 'Clinician concentration', body: 'Each clinician’s share of collections against the non-compete and retention schedule.' },
    ],
  },
  {
    slug: 'telecom-media',
    icon: 'RadioTower',
    name: 'Telecom and media',
    status: 'AVAILABLE',
    order: 3,
    pack: {
      cluster: 'technology',
      evidence: [
        'Subscriber billing and CRM exports: subscribers by month, and opening, additions, disconnects and service revenue by region and plan',
        'The rights and carriage register, and the content, affiliate and carriage agreements themselves',
        'Advertising and affiliate statements, by counterparty',
        'Capital expenditure and the P&L by year, the KPI pack and the investor presentation',
      ],
      findings: [
        'A subscriber, churn or ARPU claim the billing export contradicts',
        'A material agreement ending within 12 months of the closing',
        'One advertiser or distributor carrying a large share of its stream',
        'Content cost per subscriber or capex rising against flat ARPU',
        'Reported subscribers above the billed count, and regional concentration',
      ],
      valuation: ['No change to the valuation methods', 'Recomputed churn and ARPU as scenario inputs', 'Renewal and counterparty exposures priced by the reviewer on the purchase-price bridge'],
    },
    summary: 'Subscriber businesses priced on churn, ARPU and the agreements their content and distribution run on. Pactlab checks the claims against the billing exports and the dates against the closing.',
    dealShape: 'Acquisitions of connectivity, cable, streaming and regional media businesses.',
    questions: [
      'Do the billing exports support the subscribers, churn and ARPU in the deck?',
      'Which content, affiliate or carriage agreements end soon after the closing?',
      'Does one advertiser or distributor carry the revenue?',
      'Are content costs and capex rising while ARPU stands still?',
    ],
    vocabulary: [
      { theirs: 'ARPU', ours: 'Service revenue per subscriber a month' },
      { theirs: 'Subscriber churn', ours: 'Disconnects ÷ opening subscribers' },
      { theirs: 'Affiliate fees', ours: 'Revenue by distributor' },
    ],
    transfers: [
      { icon: 'ArrowLeftRight', title: 'Reconciliation', body: 'Reported subscribers reconciled to the billed count, as for any recurring-revenue business.' },
      { icon: 'ChartPie', title: 'Concentration', body: 'Revenue by region from billing, and by advertiser and distributor from the statements.' },
      { icon: 'TrendingUp', title: 'The P&L across every year', body: 'Revenue, margins and the content, network, carriage and marketing ratios, year by year, from the imported statements.' },
    ],
    adds: [
      { icon: 'Signal', title: 'Subscriber claims, recomputed', body: 'Subscribers, churn and ARPU from the movements export, marked verified, contradicted or unverified against the deck.' },
      { icon: 'CalendarRange', title: 'Rights windows', body: 'Every content, affiliate and carriage agreement’s end date against the expected closing; the agreement’s own date governs over the register.' },
      { icon: 'Tv', title: 'Counterparty concentration', body: 'Advertising and affiliate revenue by counterparty over the trailing twelve months.' },
      { icon: 'SlidersHorizontal', title: 'Content cost against ARPU', body: 'Content cost per subscriber and capex intensity by year, against ARPU from the same exports.' },
    ],
  },
  {
    slug: 'professional-services',
    icon: 'Briefcase',
    name: 'IT and professional services',
    status: 'AVAILABLE',
    order: 4,
    pack: {
      cluster: 'services',
      evidence: [
        'Time-and-billing exports: hours, standard value, fees billed and collected, by client and fee-earner',
        'Timesheet summaries and headcount movements, in aggregate',
        'WIP and debtor ageing reports, by year end',
        'The restrictive covenant register, client agreements and the information memorandum',
        'The P&L by year',
      ],
      findings: [
        'A top client or partner book above the ceiling the deck states',
        'Utilization below the reported level, and realization falling across years',
        'A rainmaker with no non-compete or non-solicit on file',
        'WIP or debtors over 90 days drifting up, priced',
        'Recurring against project revenue, and the largest client terminable for convenience',
      ],
      valuation: ['No change to the valuation methods', 'Realization and concentration as scenario inputs', 'Ageing drift priced into working capital on the purchase-price bridge'],
    },
    summary: 'Services firms priced on fee-earner economics: utilization, realization, and how much of the book walks out with two partners.',
    dealShape: 'Steady roll-up activity by private equity and strategic acquirers in agencies, consultancies and managed-service firms.',
    questions: [
      'Is utilization what management says, and is realization holding year on year?',
      'How much of the fees sits with one client, or with one partner’s book?',
      'Which partners carrying the book are bound by a non-compete or non-solicit?',
      'Is old WIP or unpaid debt building up?',
    ],
    transfers: [
      { icon: 'ChartPie', title: 'Concentration', body: 'Fees by client, by fee-earner and by partner book, from the time-and-billing export.' },
      { icon: 'FileText', title: 'Contract review', body: 'Client agreements, termination terms and the covenant register with exact citations.' },
      { icon: 'TrendingUp', title: 'The P&L across every year', body: 'Revenue, margins, staff, subcontractor and write-off ratios, year by year, from the imported statements.' },
    ],
    adds: [
      { icon: 'Activity', title: 'Utilization and realization', body: 'Utilization from the timesheets; realization and collection recomputed from the time-and-billing export by year, and fees reconciled to the P&L.' },
      { icon: 'UserRound', title: 'Rainmaker cover', body: 'Each revenue-carrying partner’s book against the non-compete and non-solicit cover the documents show, by pseudonymous reference.' },
      { icon: 'Hourglass', title: 'WIP and debtor ageing', body: 'Balances over 90 days by year end, with the drift priced into working capital.' },
      { icon: 'Repeat', title: 'Revenue quality', body: 'Retainer and managed-service fees against project work, from the billing data.' },
    ],
  },
  {
    slug: 'pharma-biotech',
    icon: 'Dna',
    name: 'Pharma and biotech',
    status: 'AVAILABLE',
    order: 5,
    pack: {
      cluster: 'life-sciences',
      evidence: [
        'The pipeline schedule and the trial-registry records the seller supplies',
        'Regulatory correspondence and meeting minutes',
        'The patent schedule and patent records',
        'Licence and collaboration agreements, and the seller’s model of what they cost',
        'Supply agreements, the R&D roster by pseudonymous reference and the P&L by year',
      ],
      findings: [
        'A claimed phase or readout date the registry filings contradict',
        'A key patent expiring inside the hold',
        'A milestone, royalty or fee missing from the seller’s model',
        'Single-source manufacturing and key-scientist concentration',
        'R&D spend flat while the timeline is brought forward',
      ],
      valuation: ['DCF, with exclusivity and timing as scenario inputs', 'Patent cliffs and omitted obligations priced on the purchase-price bridge'],
    },
    summary: 'Deals priced on pipeline claims and a patent estate, where the checkable failures are consistency failures.',
    dealShape: 'Acquisitions and licensing deals for pharmaceutical and biotechnology assets and companies.',
    questions: [
      'Does the phase each programme is claimed to be in match what is filed with the registry and the regulator?',
      'When does the patent protection on each product end, and does that fall inside the hold?',
      'Does the seller’s model carry every milestone, royalty and fee the licence agreements require?',
      'Is R&D spend keeping pace with the timeline the seller now claims?',
    ],
    transfers: [
      { icon: 'Layers', title: 'Evidence to valuation', body: 'The same evidence, finding, review and valuation skeleton.' },
      { icon: 'Quote', title: 'Document citations', body: 'Exact citations to registry records, correspondence, patent records and agreements.' },
      { icon: 'TrendingUp', title: 'The P&L across every year', body: 'Revenue, margins, R&D, supply costs and royalties paid, year by year, from the imported statements.' },
    ],
    adds: [
      { icon: 'FileCheck', title: 'A pipeline claims register', body: 'Each programme’s phase, status and readout date marked verified, contradicted or unverified against the filings supplied.' },
      { icon: 'Pill', title: 'The patent estate against the hold', body: 'Expiries read from the patent records, and a cliff inside the hold priced on the product’s revenue.' },
      { icon: 'Calculator', title: 'Obligations recomputed', body: 'Milestones, royalties and fees read from the agreements and looked for in the seller’s model.' },
      { icon: 'Link2', title: 'Dependence', body: 'Single-source manufacturing from the supply agreements, and key-scientist concentration from the roster.' },
    ],
  },
  {
    slug: 'ecommerce-dtc',
    icon: 'ShoppingCart',
    name: 'E-commerce and DTC',
    status: 'AVAILABLE',
    order: 6,
    pack: {
      cluster: 'consumer',
      evidence: [
        'Storefront and marketplace order exports, by month, channel and account',
        'Repeat purchase by first-purchase cohort, and ad-platform spend exports',
        'The stock report',
        'Platform account records, marketplace terms and the investor presentation',
        'The P&L by year',
      ],
      findings: [
        'A lifetime value or acquisition cost the exports contradict',
        'Channel revenue that does not reconcile to the P&L',
        'A material storefront, marketplace or ad account held personally',
        'Stock older than 180 days, priced',
        'Acquisition cost rising and contribution compressing across years',
      ],
      valuation: ['No change to the valuation methods', 'Unit economics on a contribution basis as scenario inputs', 'Aged stock priced on the purchase-price bridge'],
    },
    summary: 'Consumer-brand deals priced on lifetime value claims and on revenue that may run through accounts the seller owns personally.',
    dealShape: 'Aggregators and roll-ups acquiring consumer and direct-to-consumer brands.',
    questions: [
      'Does the lifetime value in the deck hold up on a contribution-margin basis?',
      'Does revenue by channel in the exports tie to the P&L, year by year?',
      'Who holds the storefront, marketplace and ad accounts the revenue runs through?',
      'How much of the stock is old, and what is it worth?',
    ],
    transfers: [
      { icon: 'CalendarRange', title: 'Cohorts', body: 'Repeat purchase by first-purchase cohort feeds lifetime value.' },
      { icon: 'ChartPie', title: 'Concentration', body: 'Each channel’s and account’s share of net sales, from the exports.' },
      { icon: 'FileText', title: 'Contract review', body: 'Marketplace terms and account records with exact citations.' },
      { icon: 'TrendingUp', title: 'The P&L across every year', body: 'Revenue, margins, advertising, fulfilment and fees, year by year, from the imported statements.' },
    ],
    adds: [
      { icon: 'Store', title: 'Channel revenue verified', body: 'Net sales by channel recomputed from the storefront and marketplace exports and reconciled to the P&L by year.' },
      { icon: 'Target', title: 'Cohort value on contribution', body: 'Lifetime value and acquisition cost recomputed from the orders, cohorts and ad spend, against the deck’s claims.' },
      { icon: 'KeyRound', title: 'Who holds the accounts', body: 'Each storefront, marketplace and ad account’s share of revenue, and who the documents say it is registered to.' },
      { icon: 'Warehouse', title: 'Returns and stock age', body: 'The return rate by year, and stock older than 180 days priced from the stock report.' },
    ],
  },
  {
    slug: 'multifamily',
    icon: 'Building2',
    name: 'Multifamily',
    status: 'AVAILABLE',
    order: 7,
    pack: {
      cluster: 'real-estate',
      evidence: ['Rent roll', 'Trailing-twelve-month operating statement (T-12)', 'Five years of income and expenses', 'Five years of rent and occupancy', 'Lease files', 'Delinquency reports', 'Utility bills', 'Unit-condition inspections'],
      findings: ['Loss-to-lease', 'Deferred maintenance per door', 'Delinquency concentration', 'Occupancy erosion', 'Expenses outpacing rent', 'A last-year NOI spike'],
      valuation: ['Net operating income and capitalization rate', 'Loss-to-lease upside as confirmed value, never a price increase', 'Capital expenditure per door as remediation'],
    },
    summary: 'Apartment acquisitions where the rent roll, not the offering memorandum, sets the income you pay for.',
    dealShape: 'Acquisitions of apartment communities and portfolios by real-estate private equity and operators.',
    questions: [
      'Does the rent roll support the income in the offering memorandum?',
      'How far are in-place rents below market, and is that upside real?',
      'How much deferred maintenance comes with each unit?',
      'Is delinquency spread out or concentrated?',
      'Has occupancy held over five years, and have rents kept pace with expenses?',
    ],
    transfers: [
      { icon: 'Receipt', title: 'Revenue ledger', body: 'A rent roll and T-12 map almost one to one onto the billing import and revenue ledger.' },
      { icon: 'ChartPie', title: 'Concentration', body: 'Tenant and unit concentration uses the existing analysis.' },
      { icon: 'FileText', title: 'Lease review', body: 'Lease files read with exact citations.' },
    ],
    adds: [
      { icon: 'Layers', title: 'Property operating data', body: 'Adapters for rent rolls, T-12s, delinquency reports, utility bills and inspections.' },
      { icon: 'TrendingUp', title: 'Five years of history', body: 'Income, expenses, rent and occupancy by year, with how many years each figure rests on; a missing year is asked of the seller.' },
      { icon: 'Percent', title: 'Loss-to-lease and delinquency findings', body: 'In-place rents against market, and where delinquency concentrates.' },
      { icon: 'Calculator', title: 'NOI and cap-rate valuation', body: 'Net operating income and capitalization rate, with capex per door as remediation.' },
    ],
    vocabulary: [
      { theirs: 'Rent roll', ours: 'Revenue ledger' },
      { theirs: 'Loss-to-lease upside', ours: 'Confirmed value (never a price increase)' },
    ],
  },
  {
    slug: 'commercial-property',
    icon: 'Warehouse',
    name: 'Commercial property',
    status: 'AVAILABLE',
    order: 8,
    pack: {
      cluster: 'real-estate',
      evidence: ['Lease abstracts', 'Rent roll', 'CAM reconciliations', 'Phase I environmental site assessments', 'Zoning documents'],
      findings: ['Tenant concentration', 'Near-term rollover against WALT', 'Above- and below-market leases', 'Environmental flags'],
      valuation: ['WALT and rollover schedule', 'Capitalization-rate sensitivity'],
    },
    summary: 'Office, retail and industrial assets, where lease terms and tenant concentration decide what the income is worth.',
    dealShape: 'Acquisitions of single assets and portfolios by real-estate funds and REITs.',
    questions: [
      'How much income depends on a few tenants?',
      'How much of the rent rolls over before the hold period ends?',
      'Which leases sit above or below market?',
      'Does the environmental and zoning record hold any surprises?',
    ],
    transfers: [
      { icon: 'FileText', title: 'Lease abstraction', body: 'Lease abstracts built on the document and citation machinery.' },
      { icon: 'ChartPie', title: 'Tenant concentration', body: 'Uses the existing concentration analysis.' },
      { icon: 'Calculator', title: 'Scenarios', body: 'Rollover and cap-rate inputs run in the same scenario engine.' },
    ],
    adds: [
      { icon: 'ClipboardList', title: 'Lease and CAM evidence', body: 'Adapters for lease abstracts, rent rolls and CAM reconciliations.' },
      { icon: 'Hourglass', title: 'Rollover findings', body: 'Near-term expiries against the weighted average lease term.' },
      { icon: 'ShieldAlert', title: 'Environmental and zoning flags', body: 'Findings from Phase I assessments and zoning documents.' },
    ],
  },
  {
    slug: 'hotels',
    icon: 'Hotel',
    name: 'Hotels and hospitality',
    status: 'AVAILABLE',
    order: 9,
    pack: {
      cluster: 'real-estate',
      evidence: ['PMS and STR reports', 'Franchise and brand agreements', 'Management contracts', 'Occupancy, ADR and RevPAR history', 'Food-and-beverage P&Ls'],
      findings: ['Deferred brand PIP capex', 'Franchise encumbrance and termination windows', 'Demand seasonality and concentration'],
      valuation: ['RevPAR and GOP-margin trends', 'PIP capex as remediation or price terms'],
    },
    summary: 'An operating business on a property: room revenue, brand obligations and the capex the brand will demand.',
    dealShape: 'Acquisitions of branded and independent hotels by hospitality funds, owner-operators and REITs.',
    questions: [
      'Is RevPAR keeping pace with the competitive set?',
      'What property-improvement plan will the brand require, and who pays for it?',
      'What do the franchise and management agreements allow at a sale?',
      'How seasonal or concentrated is demand?',
    ],
    transfers: [
      { icon: 'ChartLine', title: 'Revenue metrics', body: 'Daily revenue history fits the metrics engine’s period and cohort machinery.' },
      { icon: 'FileText', title: 'Contract review', body: 'Franchise, brand and management agreements with exact citations.' },
      { icon: 'Calculator', title: 'Scenarios', body: 'RevPAR and margin inputs run in the same scenario engine.' },
    ],
    adds: [
      { icon: 'Database', title: 'Hotel operating data', body: 'Adapters for PMS, STR and food-and-beverage reports.' },
      { icon: 'Stamp', title: 'Brand and franchise findings', body: 'PIP obligations, encumbrances and termination windows.' },
      { icon: 'Snowflake', title: 'Demand findings', body: 'Seasonality and demand concentration from occupancy history.' },
    ],
  },
  {
    slug: 'small-clinics',
    icon: 'Stethoscope',
    name: 'Small clinics',
    status: 'AVAILABLE',
    order: 10,
    pack: {
      cluster: 'healthcare',
      evidence: [
        'Remittances by payer, collections by clinician, credentialing and payer contract registers (from the healthcare pack)',
        'Service lines by provider, with direct costs',
        'Visits by referral source',
        'Patient volume, equipment schedule and coding summary',
        'The clinic lease, the memorandum and the P&L by year',
      ],
      findings: ['The selling owner as the only provider of a service line', 'One dominant referral source', 'A lease ending soon after closing with no renewal', 'Supplies and other costs outpacing revenue across years', 'Provider concentration, coding above policy and aged equipment'],
      valuation: ['DCF, with owner and referral dependence as reviewer-priced haircuts', 'Relocation or renegotiation risk and equipment replacement on the purchase-price bridge'],
    },
    summary: 'Clinics of a few sites, where the risks concentrate: one owner-operator, one referral source, one lease.',
    dealShape: 'Private-equity and strategic buyers of physician, dental, veterinary and therapy clinics. The few-site variant of the healthcare services pack.',
    questions: [
      'How much of the clinic does the selling owner deliver, and which service lines does only the owner provide?',
      'Does one referral source send most of the patients?',
      'How long does the lease run after closing, and can it be renewed or assigned?',
      'Are costs such as supplies growing faster than revenue across the years?',
    ],
    transfers: [
      { icon: 'HeartPulse', title: 'The healthcare evidence, reused', body: 'Collections, denials, payer mix, credentials and payer contracts, read exactly as the healthcare pack reads them.' },
      { icon: 'UserRound', title: 'Providers by pseudonymous reference', body: 'The owner and every provider appear only as references such as P01, never by name, and never reach a model.' },
      { icon: 'TrendingUp', title: 'The P&L across every year', body: 'Revenue, margins and the clinic’s key cost ratios, year by year, from the imported statements.' },
    ],
    adds: [
      { icon: 'Users', title: 'Owner-operator dependence', body: 'The selling owner’s share of visits and collections by service line, and the lines no associate covers.' },
      { icon: 'Link2', title: 'Referral concentration', body: 'Visits by referral source recomputed from the schedule export.' },
      { icon: 'KeyRound', title: 'The lease as evidence', body: 'The term left after closing, the renewal option and assignment on a sale, each quoted from the lease.' },
    ],
  },
  {
    slug: 'hospitals',
    icon: 'Hospital',
    name: 'Hospitals',
    status: 'AVAILABLE',
    order: 11,
    pack: {
      cluster: 'healthcare',
      evidence: ['Payer mix', 'Census and average daily census', 'Medicare cost reports', 'Licensure and accreditation records', 'Malpractice history'],
      findings: ['Payer concentration', 'Licensure and accreditation gaps', 'Key-physician dependence'],
      valuation: ['Payer-mix-adjusted EBITDA', 'Regulatory capital expenditure'],
    },
    summary: 'Hospital acquisitions, where payer mix, licensure and key physicians decide what the earnings are worth.',
    dealShape: 'Acquisitions of acute-care and specialty hospitals by health systems and healthcare private equity. Extends the healthcare services pack.',
    questions: [
      'How dependent are earnings on one payer?',
      'Are licensure and accreditation current and transferable?',
      'Which service lines depend on a few physicians?',
      'What regulatory capex is already committed?',
    ],
    transfers: [
      { icon: 'HeartPulse', title: 'Healthcare services findings', body: 'Reimbursement and regulatory finding types from the healthcare services pack.' },
      { icon: 'UserRound', title: 'Key-person risk', body: 'Key-physician dependence as aggregates, with named data gated.' },
      { icon: 'Calculator', title: 'Scenarios', body: 'Payer-mix inputs run in the same scenario engine.' },
    ],
    adds: [
      { icon: 'Activity', title: 'Census and cost-report evidence', body: 'Adapters for payer mix, census and Medicare cost reports.' },
      { icon: 'BadgeCheck', title: 'Licensure findings', body: 'Licensure and accreditation gaps, and malpractice history.' },
      { icon: 'Coins', title: 'Payer-mix-adjusted EBITDA', body: 'Earnings adjusted for payer mix, with regulatory capex as remediation.' },
    ],
  },
  {
    slug: 'venture-raise',
    icon: 'Rocket',
    name: 'Venture Raise',
    status: 'AVAILABLE',
    order: 12,
    pack: {
      cluster: 'capital',
      evidence: ['Cap table (Carta and Pulley exports)', 'Billing and bank records', 'Certificate of incorporation, bylaws and 83(b) confirmations', 'IP assignment and contractor agreements', 'SAFEs, notes and term sheets', 'Code and delivery history'],
      findings: ['Deck metrics contradicted by billing', 'IP assignment gaps', 'Cap table that does not reconcile', 'SAFE and MFN stacking', 'Runway shorter than the raise assumes'],
      valuation: ['The round at your ask, adjusted by what the evidence forces', 'SAFE and note conversion at cap and discount', 'Option-pool shuffle stated in shares and percent', 'Competing offers side by side; confirmed value stays confidential, never a reason to ask more'],
    },
    summary: 'Founder-side diligence: walk into a raise knowing what investors will find, with every competing offer modelled.',
    dealShape: 'Pre-seed, seed and Series A rounds from angels, incubators and accelerators, and venture funds — seen from the founder’s seat.',
    questions: [
      'Will the deck metrics survive the investor’s billing check?',
      'Does the cap table reconcile to the corporate record?',
      'How much do the SAFEs and the pool shuffle really dilute the founders?',
      'Does the company own the IP its contractors built?',
      'Which offer leaves the founders with what, and on what terms?',
    ],
    transfers: [
      { icon: 'TrendingUp', title: 'Revenue and SaaS metrics', body: 'MRR and ARR from billing, the same check an investor runs.' },
      { icon: 'GitBranch', title: 'Code and delivery evidence', body: 'The history technical diligence will read, seen by the founder first.' },
      { icon: 'FileText', title: 'Documents with exact citations', body: 'Corporate records, agreements and term sheets, quoted to the page.' },
    ],
    adds: [
      { icon: 'ListChecks', title: 'A claims register for the deck', body: 'Every number checked against evidence: verified, contradicted or unverified.' },
      { icon: 'Percent', title: 'Round modelling', body: 'SAFE conversion, MFN effects and the pool shuffle across priced-round scenarios.' },
      { icon: 'Handshake', title: 'Competing offers', body: 'Each investor’s terms side by side, with the founders’ ownership after each.' },
      { icon: 'EyeOff', title: 'An investor view that cannot leak', body: 'Share verified numbers and the data room; your weaknesses never cross over.' },
    ],
  },
  {
    slug: 'multifamily-syndication',
    icon: 'HandCoins',
    name: 'Multifamily syndication',
    status: 'AVAILABLE',
    order: 13,
    pack: {
      cluster: 'real-estate',
      evidence: ['Everything the Multifamily pack reads: rent roll, T-12, leases, delinquency and inspections', 'Private placement memorandum (PPM)', 'Operating agreement', 'Investor deck', 'Sponsor track record: prior deals with projected and actual returns'],
      findings: ['Projected IRR or equity multiple the waterfall does not support', 'Track-record claims with no actuals behind them', 'A fee in the operating agreement missing from the PPM summary', 'Preferred return or promote described differently in the PPM', 'A thin or missing track record, shown as a gap'],
      valuation: ['The property priced on NOI and cap rate, as in the Multifamily pack', 'The waterfall recomputed from the operating agreement, in decimals', 'Investor returns after pref and promote on downside, base and upside paths, labelled as scenarios, never promises'],
    },
    summary: 'A sponsor buying a large multifamily property and raising the equity: the property and the offering, each checked against its evidence.',
    dealShape: 'Sponsors acquiring apartment communities with equity raised from accredited investors under Rule 506(b) or 506(c).',
    questions: [
      'Does the property support the returns the PPM projects?',
      'Does the waterfall in the operating agreement produce the IRR the deck states?',
      'Is every fee in the operating agreement disclosed in the PPM?',
      'What does the sponsor’s track record show, deal by deal, projected against actual?',
    ],
    transfers: [
      { icon: 'Building2', title: 'The Multifamily pack, unchanged', body: 'Rent roll, T-12, inspections and NOI ÷ cap rate, by reference.' },
      { icon: 'ListChecks', title: 'Claims register', body: 'Every offering claim verified, contradicted or unverified, linked to its evidence.' },
      { icon: 'FileText', title: 'Exact citations', body: 'Fees and splits quoted to the page of the PPM and operating agreement.' },
    ],
    adds: [
      { icon: 'FileSearch', title: 'Offering terms read for you', body: 'Fees, pref and promote proposed from the documents, each with its quote; you confirm them.' },
      { icon: 'Calculator', title: 'A deterministic waterfall', body: 'Return of capital, pref and promote tiers recomputed from the confirmed terms.' },
      { icon: 'History', title: 'Sponsor track record', body: 'Prior deals with projected and actual returns; missing actuals shown as missing.' },
      { icon: 'EyeOff', title: 'A wall between the two sides', body: 'The seller never sees the raise; investors never see the acquisition negotiation.' },
    ],
  },
  {
    slug: 'music-rights',
    icon: 'Tag',
    name: 'Music rights',
    status: 'AVAILABLE',
    order: 14,
    pack: {
      cluster: 'media-rights',
      evidence: ['Works and rights register: titles, ISWC and ISRC codes, PRO registrations', 'Writer splits from split sheets and as statements pay them', 'Chain of title: Copyright Office registrations, assignments, licences and administration agreements', 'Royalty statements by work, period and income source', 'Advance ledgers, lien and UCC searches'],
      findings: ['An earning work with no assignment or registration behind it', 'Splits that do not total 100%, or statements paying different splits', 'Income whose grants become terminable under §203 or §304 inside the hold', 'One work or writer carrying too much of the income', 'An unrecouped advance or a lien the deal summary leaves out', 'Registered works with no performance income, and missing statement periods'],
      valuation: ['A royalty multiple on trailing net income (net publisher’s share or net label share), decay-adjusted by catalog age', 'Termination exposure priced as its own line on the bridge', 'Verified growth and clean title recorded as confirmed value, never a price increase'],
    },
    summary: 'A buyer acquiring music publishing or master rights: every work’s income, title and termination windows traced to statements and registrations.',
    dealShape: 'Funds, catalog acquirers and labels buying publishing and master catalogs from artists, estates, publishers or prior funds.',
    questions: [
      'Does the seller hold title to the works that earn the money?',
      'Do the splits add up, and do statements pay what the split sheets say?',
      'How much of the income can authors take back before the hold ends?',
      'Is any advance still unrecouped, or any lien undisclosed?',
    ],
    transfers: [
      { icon: 'ListChecks', title: 'Findings and review', body: 'Every gap drafted with its evidence; a named reviewer decides.' },
      { icon: 'FileText', title: 'Exact citations', body: 'Ledgers, split sheets and lien searches quoted to the page.' },
      { icon: 'Calculator', title: 'The purchase-price bridge', body: 'Accepted risks priced line by line against the multiple.' },
    ],
    adds: [
      { icon: 'ClipboardList', title: 'A works and rights register', body: 'Every work with its identifiers, splits, chain of title and income.' },
      { icon: 'ChartLine', title: 'A royalty income model', body: 'Trailing income by work and source, with decay by catalog age, in decimals.' },
      { icon: 'Hourglass', title: 'Termination exposure', body: 'Section 203 and 304 windows from the grant dates, the exposed income quantified.' },
      { icon: 'FileSearch', title: 'Rights documents read for you', body: 'Statements, split sheets and agreements proposed as entries with their quotes; you confirm them.' },
    ],
  },
  {
    slug: 'energy-generation',
    icon: 'Signal',
    name: 'Energy generation & rights',
    status: 'AVAILABLE',
    order: 15,
    pack: {
      cluster: 'energy',
      evidence: ['Plant register: capacity, fuel, age, capacity factor and power purchase agreements', 'Interest register: mineral, royalty and working interests, leases and division-order decimals', 'Production history for plants and wells', 'Third-party reserve reports, cited as the engineers state them', 'Title opinions, leases, permits, closure plans and decommissioning studies', 'The seller’s liability schedule'],
      findings: ['Remediation or coal-ash obligations in the evidence but missing from the liability schedule', 'An asset-retirement obligation booked well below the decommissioning estimate', 'Production falling faster than the reserve report assumes', 'Acreage not held by production expiring inside the hold', 'A division-order decimal the lease royalty chain does not support', 'A PPA ending inside the hold, leaving merchant exposure', 'A break in the chain of title, and required controls missing from the capex plan'],
      valuation: ['A reserve-based DCF for the interests, from the third-party report’s categories', '$/kW of capacity plus contract coverage for the plants', 'Unbooked remediation and the ARO shortfall priced as remediation costs and escrows; clean title and over-booked ARO recorded as confirmed value only'],
    },
    summary: 'A buyer acquiring power plants, energy businesses and oil & gas interests: title, production, reserves and every environmental and retirement obligation traced to its evidence.',
    dealShape: 'Funds, utilities, independent power producers and mineral buyers acquiring plants and oil & gas interests from utilities, IPPs, E&P companies and mineral owners.',
    questions: [
      'Is every environmental and retirement obligation on the seller’s schedule, at the right size?',
      'Does production support the reserve report’s decline?',
      'How much acreage could lapse before the hold ends?',
      'Do the division orders pay what the leases support?',
    ],
    transfers: [
      { icon: 'ListChecks', title: 'Findings and review', body: 'Every gap drafted with its evidence; a named reviewer decides.' },
      { icon: 'FileText', title: 'Exact citations', body: 'Closure plans, studies, title opinions and division orders quoted to the page.' },
      { icon: 'Calculator', title: 'The purchase-price bridge', body: 'Accepted liabilities priced line by line, as remediation costs and escrows.' },
    ],
    adds: [
      { icon: 'ClipboardList', title: 'An asset and interest register', body: 'Plants and interests with capacity, contracts, leases, decimals and production.' },
      { icon: 'ChartLine', title: 'A production and reserves model', body: 'Decline from the production history against the third-party report, in decimals.' },
      { icon: 'ShieldAlert', title: 'A liability model', body: 'Remediation, coal ash and decommissioning estimates against what the seller booked.' },
      { icon: 'FileSearch', title: 'Reports read for you', body: 'Reserve reports and environmental reports proposed as entries with their quotes; you confirm them.' },
    ],
  },
  {
    slug: 'startup-spv',
    icon: 'Users',
    name: 'Startup equity SPV',
    status: 'AVAILABLE',
    order: 16,
    pack: {
      cluster: 'capital',
      evidence: ['The startup’s billing, cap table and monthly cash and burn', 'The round summary or deck, the term sheet and the signed SAFEs and notes', 'The vehicle’s operating agreement and the investor summary', 'Side letters and the Form D filing', 'Each investor’s commitment and accreditation status, from a verification specialist'],
      findings: ['A cap table that does not add up once every SAFE and note converts', 'Instrument terms in the signed documents that differ from the deck', 'A deck claim billing or the bank balance contradicts, or that nothing supports', 'Fee or carry in the operating agreement that differs from the investor summary', 'A side letter granting economics the summary does not disclose', 'A 506(c) investor not verified, or no Form D on file'],
      valuation: ['The round’s pre-money, recomputed from the price and the share count', 'The vehicle’s fee load recomputed from its operating agreement', 'Net-of-fees investor returns on exit paths you state, labelled as scenarios, never promises'],
    },
    summary: 'An organizer pooling investors into one vehicle for a startup’s round: the round and the vehicle’s own economics, each checked against its documents.',
    dealShape: 'Angels, syndicate leads and emerging managers raising a single-company SPV that takes one line in a seed or Series A round.',
    questions: [
      'Does the cap table add up once the SAFEs convert?',
      'Do the deck’s claims hold up against billing and the bank balance?',
      'Do the fee and carry investors were told match the operating agreement?',
      'Is every investor eligible for the vehicle’s exemption?',
    ],
    transfers: [
      { icon: 'ListChecks', title: 'Findings and review', body: 'Every defect drafted with its evidence; a named reviewer decides.' },
      { icon: 'FileText', title: 'Exact citations', body: 'Round summaries, SAFEs and operating agreements quoted to the page.' },
      { icon: 'ClipboardCheck', title: 'The claims register', body: 'Every deck claim marked verified, contradicted or unverified.' },
    ],
    adds: [
      { icon: 'Calculator', title: 'Round-math verification', body: 'Shares × price against the round, every SAFE and note converted with its cap, discount and MFN.' },
      { icon: 'Percent', title: 'Vehicle economics', body: 'Fee load and carry recomputed from the operating agreement and checked against the summary.' },
      { icon: 'UserCheck', title: 'Investor seats', body: 'Each investor seated on their own, with accreditation tracked from a specialist; never shown each other.' },
      { icon: 'EyeOff', title: 'A published investor view', body: 'A frozen snapshot of what you choose to share; side letters and other investors never enter it.' },
    ],
  },
];

export interface PactCard {
  readonly id: string;
  readonly name: string;
  /** The outcome, in one line. */
  readonly line: string;
  readonly href: string;
  /** The pack's illustration in public/illustrations. */
  readonly image: string;
}

/**
 * An industry's editorial illustration (T-143): square art, shown cover-cropped in the 640×420 slots.
 * The flat SVGs stay in public/ until the new set is proven live.
 */
export const industryArt = (slug: string) => `/illustrations/${slug}.webp`;

const industryName = (slug: string) => INDUSTRIES.find((industry) => industry.slug === slug)?.name ?? slug;
const packCard = (slug: string, line: string): PactCard => ({
  id: slug,
  name: industryName(slug),
  line,
  href: `/industries/${slug}`,
  image: industryArt(slug),
});

/**
 * The pacts shown as slides in the home page's top slider (T-086). Order is deliberate:
 * the core technology deal first, the packs through the middle, and the
 * founder's side of the table last.
 */
export const PACT_CARDS: readonly PactCard[] = [
  {
    id: 'technology',
    name: 'Technology acquisition',
    line: 'Diligence a software company end to end: code, contracts, financials and valuation.',
    href: '/product',
    image: industryArt('software-saas'),
  },
  packCard('fintech', 'Check payment volume, licences and loss rates against the evidence before you sign.'),
  packCard('healthcare', 'Check payer mix, denials and every clinician’s licence against the evidence.'),
  packCard('telecom-media', 'Check subscriber claims, rights windows and who carries the revenue against the exports.'),
  packCard('professional-services', 'Check realization, client and partner concentration and rainmaker cover.'),
  packCard('pharma-biotech', 'Check pipeline claims, patent dates and licence payments against the documents.'),
  packCard('ecommerce-dtc', 'Check LTV on contribution, channel revenue and who holds each account against the exports.'),
  packCard('multifamily', 'Tie the rent roll and T-12 to the offering memorandum, unit by unit.'),
  packCard('commercial-property', 'See tenant concentration, lease rollover and recoveries before you price.'),
  packCard('hotels', 'Weigh RevPAR, franchise terms and PIP capex against the asking price.'),
  packCard('small-clinics', 'Check the owner, the referral sources and the lease behind a clinic of a few sites.'),
  packCard('hospitals', 'Value on payer-mix-adjusted EBITDA, with census and accreditation in view.'),
  packCard('multifamily-syndication', 'Check the property and the offering: returns, fees and track record.'),
  packCard('music-rights', 'Trace each work’s income, title and termination windows before you buy the catalog.'),
  packCard('energy-generation', 'Check title, reserves and every environmental liability before you buy the assets.'),
  packCard('startup-spv', 'Check the round and your own vehicle before you pool the money.'),
  packCard('venture-raise', 'You are the one being diligenced. See what the investor will find, first.'),
];

/** Slide copy for the pacts written up so far; any other published pact falls back to its card's line and its pack's findings. */
export const PACT_SLIDE_COPY: Readonly<Record<string, Pick<Slide, 'short' | 'title' | 'body' | 'points' | 'imageAlt'> & { readonly linkLabel: string; readonly icon: IconName }>> = {
  technology: {
    short: 'Technology',
    icon: 'AppWindow',
    title: 'Buying a software company? Diligence it end to end.',
    body:
      'Pactlab reads the recurring revenue, the code, the delivery history and the contracts, reconciles them to the ' +
      'seller’s numbers, and carries every accepted finding into Sextant’s valuation.',
    points: ['ARR and churn reconciled to the invoices', 'Code, licenses and key people traced', 'Accepted findings priced into the bridge'],
    imageAlt: 'Software and SaaS: code, recurring revenue and commit history',
    linkLabel: 'Run a technology pact',
  },
  multifamily: {
    short: 'Multifamily',
    icon: 'Building2',
    title: 'The rent roll sets the price, not the offering memorandum.',
    body:
      'Pactlab ties the rent roll, the T-12 and the lease files to the offering memorandum unit by unit, so loss-to-lease, ' +
      'delinquency and deferred maintenance are in the net operating income before you bid.',
    points: ['Rent roll and T-12 tied to the memorandum', 'Loss-to-lease and delinquency by unit', 'Capital expenditure per door priced as remediation'],
    imageAlt: 'Multifamily: apartment buildings, the rent roll and net operating income',
    linkLabel: 'Run a multifamily pact',
  },
  'energy-generation': {
    short: 'Energy',
    icon: 'Signal',
    title: 'Price the liabilities before you inherit them.',
    body:
      'Pactlab sets every remediation, coal-ash and decommissioning estimate against what the seller booked, checks ' +
      'production against the reserve report and the division orders against the leases, before you sign.',
    points: ['Unbooked remediation and ARO shortfalls priced', 'Lease expiry and decimal errors quantified', 'Reserves as the third-party report states them'],
    imageAlt: 'Energy generation and rights: a power plant, a well site and a liability schedule',
    linkLabel: 'Run an energy pact',
  },
  healthcare: {
    short: 'Healthcare',
    icon: 'HeartPulse',
    title: 'The remittances set the price, not the deck.',
    body:
      'Pactlab recomputes collections, denials and the payer mix from the remittances, checks every clinician’s licence ' +
      'against the verification documents and each clinician’s share of collections against the non-compete schedule, before you bid.',
    points: ['Denials and payer mix recomputed by year', 'Clinicians collecting after a licence expired', 'Concentration without a non-compete on file'],
    imageAlt: 'Healthcare services: a clinic building, a heartbeat line and a claims checklist',
    linkLabel: 'Run a healthcare pact',
  },
  'pharma-biotech': {
    short: 'Pharma',
    icon: 'Dna',
    title: 'The pipeline is a set of claims. Check them against the filings.',
    body:
      'Pactlab checks each programme’s claimed phase and readout against the registry records and correspondence you supply, ' +
      'dates every patent against the hold after closing and looks for every milestone the licence agreements require in the seller’s model.',
    points: ['Claimed phases against the registry filings', 'Patent cliffs inside the hold, priced', 'Milestones missing from the seller’s model'],
    imageAlt: 'Pharma and biotech: a DNA helix, a capsule and a patent document with a calendar',
    linkLabel: 'Run a pharma pact',
  },
  'telecom-media': {
    short: 'Telecom',
    icon: 'RadioTower',
    title: 'Churn is a claim. Recompute it from the billing export.',
    body:
      'Pactlab recomputes subscribers, churn and ARPU from the billing exports against the deck, reads every content, affiliate and carriage ' +
      'agreement’s end date against the closing, and measures who carries the advertising and affiliate revenue before you bid.',
    points: ['Churn and ARPU recomputed, against the deck', 'Agreements ending within a year of the closing', 'Content cost per subscriber against flat ARPU'],
    imageAlt: 'Telecom and media: a broadcast tower, a video player and a row of subscribers',
    linkLabel: 'Run a telecom pact',
  },
  'professional-services': {
    short: 'Services',
    icon: 'Briefcase',
    title: 'The fees walk on two legs. Check who carries them.',
    body:
      'Pactlab recomputes utilization, realization and fees by client and by partner book from the time-and-billing exports, ' +
      'checks them against the deck’s ceilings, and reads which rainmakers are bound by a non-compete or non-solicit before you bid.',
    points: ['Client and partner concentration against the deck', 'Realization by year, reconciled to the P&L', 'Rainmakers with no covenant on file'],
    imageAlt: 'IT and professional services: a briefcase, a utilization chart and a small team shown in aggregate',
    linkLabel: 'Run a services pact',
  },
  'ecommerce-dtc': {
    short: 'E-commerce',
    icon: 'ShoppingCart',
    title: 'Lifetime value is a claim. Recompute it on contribution.',
    body:
      'Pactlab recomputes revenue by channel from the storefront and marketplace exports, recomputes lifetime value on a contribution-margin basis ' +
      'against the deck, and reads who holds each storefront, marketplace and ad account before you bid.',
    points: ['LTV recomputed on contribution, against the deck', 'Accounts the founder holds personally', 'Stock older than 180 days, priced'],
    imageAlt: 'E-commerce and DTC: a storefront, a shopping bag with a repeat arrow and repeat purchase by cohort',
    linkLabel: 'Run an e-commerce pact',
  },
  'startup-spv': {
    short: 'Startup SPV',
    icon: 'Users',
    title: 'Pool the money on a round that adds up.',
    body:
      'Pactlab recomputes the startup’s cap table with every SAFE converted, checks each deck claim against its evidence, ' +
      'recomputes your vehicle’s fee and carry, and publishes to investors only what you choose.',
    points: ['Cap table and SAFE conversions recomputed', 'Fee and carry checked against the investor summary', 'A frozen investor view, never another investor’s terms'],
    imageAlt: 'Startup equity SPV: investors pooled into one vehicle on a startup’s cap table',
    linkLabel: 'Run a startup SPV pact',
  },
};

/** The most pacts the top slider shows; every other published pact is one click away via "All pacts". */
export const MAX_FEATURED_PACTS = 3;

/**
 * The pacts featured in the top slider, in order: pick the newest release or the one being pushed.
 * Unpublished ids are skipped, and at most MAX_FEATURED_PACTS show.
 */
export const FEATURED_PACTS: readonly string[] = ['technology', 'multifamily'];

/** A pact as a slide in the home page's top slider, beside the message slides. */
export function pactSlide(card: PactCard): Slide {
  const copy = PACT_SLIDE_COPY[card.id];
  const industry = INDUSTRIES.find((entry) => entry.slug === card.id);
  return {
    id: `pact-${card.id}`,
    group: 'pact',
    short: copy?.short ?? card.name,
    icon: copy?.icon ?? industry?.icon,
    eyebrow: `${card.name} pact`,
    title: copy?.title ?? card.name,
    body: copy?.body ?? card.line,
    points: copy?.points ?? industry?.pack?.findings ?? [],
    image: card.image,
    imageAlt: copy?.imageAlt ?? `${card.name} illustration`,
    link: { href: card.href, label: copy?.linkLabel ?? `Run a ${card.name.toLowerCase()} pact` },
  };
}

export const NAV = [
  { href: '/product', label: 'Product' },
  { href: '/industries', label: 'Industries' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/case-studies', label: 'Case studies' },
  { href: '/trust', label: 'Trust' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/try', label: 'Try it' },
  { href: '/about', label: 'About' },
  { href: '/pilot', label: 'Pilot' },
] as const;

/** Pages under About. */
export const ABOUT_PAGES = [
  { href: '/about/story', label: 'The story of the pact', detail: 'Why a Roman handshake gave Pactlab its name.', icon: 'Handshake' },
  { href: '/about/vision', label: 'Founder’s vision', detail: 'Price every asset. Protect every asset. Before, during and after the deal.', icon: 'Target' },
  { href: '/trust', label: 'Security and trust', detail: 'How deal data is isolated, audited and protected on AWS.', icon: 'ShieldCheck' },
] as const satisfies readonly { href: string; label: string; detail: string; icon: IconName }[];

/** Words the brand never uses (`brand/BRAND.md`, Voice). */
export const BANNED_WORDS = ['revolutionary', 'game-changing', 'game changing', 'supercharge'] as const;

/** Homepage feature arcs and animated demos (merged from the single-page expansion). */
export const PILLAR = 'AI diligence. Human instinct.';

export const HERO = {
  eyebrow: 'Deal management and execution for private equity and corporate development',
  title: TAGLINE,
  body: `${POSITIONING} Every number traces back to its source. Every conclusion is signed off by a person.`,
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
  body: 'We are working with a small number of design partners on live deals. If you buy or invest in companies in any of these sectors, talk to us.',
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

/** Home page top slider: the four things Pactlab stands for, followed by one slide per published pact. */
export interface Slide {
  readonly id: string;
  /** Platform message or runnable pact: the slider groups its buttons by this. */
  readonly group: 'platform' | 'pact';
  /** The slide's button label: a word or two. */
  readonly short: string;
  /** Shown on pact slides beside the "Pact" tag. */
  readonly icon?: IconName;
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
    group: 'platform',
    short: 'AI rigor',
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
    group: 'platform',
    short: '360° view',
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
    group: 'platform',
    short: 'Sextant',
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
    group: 'platform',
    short: 'Security',
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
  {
    id: 'assistant',
    group: 'platform',
    short: 'Ask Claude',
    eyebrow: 'Pactlab in your AI assistant',
    title: 'Ask about your deal from Claude.',
    body:
      'Connect Pactlab to Claude or any assistant that supports MCP. Ask which risks are still open, what the bridge looks like, or what the price ' +
      'would be at a different multiple, and get answers drawn from your pacts, cited to the evidence, with your permissions.',
    points: ['Findings, claims and valuation on request', 'What-if pricing from the same calculations', 'Read-only, with every call audited'],
    image: '/illustrations/slide-assistant.svg',
    imageAlt: 'A chat with an AI assistant answering from a Pactlab pact, with a citation to the source document',
    link: { href: '/product/assistant', label: 'Connect your assistant' },
  },
];

/**
 * The top slider's rotation: platform and pact slides alternate, so a concrete pact shows within the
 * first two slides; whichever group is longer finishes the rotation. The buttons stay grouped.
 */
export function heroSlides(pacts: readonly Slide[], platforms: readonly Slide[] = CAROUSEL): Slide[] {
  const slides: Slide[] = [];
  for (let position = 0; position < Math.max(platforms.length, pacts.length); position += 1) {
    const platform = platforms[position];
    const pact = pacts[position];
    if (platform) slides.push(platform);
    if (pact) slides.push(pact);
  }
  return slides;
}

/** Promotion bar above the header. */
export const ANNOUNCEMENT = {
  text: 'Now onboarding design partners for live deals.',
  link: { href: '/pilot', label: 'Request a pilot' },
};

/** The name: where "pact" comes from, and why a lab. */
export const NAME_STORY = {
  eyebrow: 'Why Pactlab',
  title: 'Every great deal starts as a pact.',
  teaser:
    'In Rome, a pact was sealed with clasped right hands and a solemn question: do you promise? Two thousand years later, ' +
    'the handshake is still the moment of truth. Pactlab is where that promise gets tested first.',
  chapters: [
    {
      title: 'Pactum: an agreement that makes peace',
      body:
        'Our word pact comes from the Latin pactum, from pacisci, “to agree” — the same root as pax, peace. ' +
        'To Romans a pact was how two sides stopped bargaining and settled: on a boundary, a debt, a marriage, a merger of fortunes.',
    },
    {
      title: 'Clasped right hands: the sign of good faith',
      body:
        'Romans sealed agreements with the dextrarum iunctio, the joining of right hands. The right hand belonged to Fides, ' +
        'the goddess of good faith, and clasped hands appear on Roman coins and monuments as her emblem.',
    },
    {
      title: 'Spondesne? Spondeo. The question before the promise',
      body:
        'For a promise to bind, Roman law asked for a formal exchange — the stipulatio. One party asked “Do you promise?”, ' +
        'the other answered “I promise”, in the same words, face to face. A bare agreement without that form, a nudum pactum, ' +
        'gave no claim in court. The Romans knew a handshake alone is not enough.',
    },
    {
      title: 'Lab: where the promise is tested',
      body:
        'Every acquisition is a pact: a price agreed on the strength of promises about revenue, technology, contracts and people. ' +
        'Pactlab is the lab where those promises are tested against the evidence — before the hands are clasped, and long after.',
    },
  ],
  closing: 'Pact + lab. Test the pact before you sign it.',
} as const;

/** Founder's vision, in the founder's own voice. */
export const FOUNDER = {
  name: 'Kumar Ramachandran',
  role: 'Founder, Pactlab',
  initials: 'KR',
  photo: '/team/kumar-ramachandran.jpg',
  linkedin: 'https://www.linkedin.com/in/kuramach/',
  title: 'An excellent business, at the right price. Then keep what you paid for.',
  intro:
    'I have spent my career at the deal table, in technology and in real estate: software companies and platforms, ' +
    'apartment portfolios and commercial property. Different assets, different counterparties, and the same lesson every time.',
  dealsIntro: 'I have seen companies and properties bought for every reason a buyer buys:',
  deals: [
    { icon: 'TrendingUp', title: 'Top-line growth', body: 'Buying revenue, customers and a pipeline faster than they could be built.' },
    { icon: 'Target', title: 'New markets', body: 'Entering a geography or a segment through a business already trusted there.' },
    { icon: 'Layers', title: 'Consolidation', body: 'Buying out a competitor to take its customers and its place in the market.' },
    { icon: 'Boxes', title: 'Volume and scale', body: 'More customers through the same platform, more doors under the same management, at a lower cost each.' },
  ],
  artTitle: 'Pricing a deal is an art, not a search for the lowest number',
  art: [
    'No deal turns on price alone. Every one holds competing terms in tension: price against earn-out, escrow against ' +
      'indemnity, speed to close against depth of diligence, the seller’s retention against the buyer’s plan. Move one and the others move with it.',
    'The cheapest deal is rarely the most lucrative. A low price for a business with fragile revenue, unowned code or a rent roll ' +
      'that does not hold up is not a bargain; it is a discount on problems you will pay for later. A fair price for an excellent asset compounds.',
  ],
  principle: {
    quote: 'It’s far better to buy a wonderful company at a fair price than a fair company at a wonderful price.',
    attribution: 'Warren Buffett, 1989 letter to Berkshire Hathaway shareholders, crediting the lesson to Charlie Munger',
    body:
      'Munger’s discipline is the one Pactlab is built for: know whether the business is excellent, decide what it is worth to you, ' +
      'and agree the terms that protect that value.',
  },
  problemTitle: 'What every one of those deals was missing',
  problems: [
    {
      title: 'No holistic view of the assets',
      body:
        'Revenue sat in one spreadsheet, the code or the property condition in a technical memo, the contracts in a data room and the people in an HR summary. ' +
        'Nobody could see the assets together, so nobody could see how they depended on each other.',
    },
    {
      title: 'Risk and reward never calibrated',
      body:
        'Findings arrived as prose, late, and rarely made it into the price or the terms. We negotiated on a model that did not know what diligence had found, ' +
        'and could not say how much risk we were taking for the return we expected.',
    },
    {
      title: 'Value lost after closing, above all people',
      body:
        'Once the deal closed, the diligence went into a drawer. The engineers who held the product together, the account owners, the ' +
        'specialists, the human capital we had paid for, walked out in the first year, and the value went with them.',
    },
  ],
  visionTitle: 'Why I built Pactlab',
  vision:
    'Pactlab is one platform for the whole life of a deal. It shows whether the asset is as good as it looks, prices every finding ' +
    'against your risk tolerance, weighs the terms against each other so you negotiate the whole deal rather than the headline number, ' +
    'and keeps protecting what you bought after close, so the value you paid for is the value you keep.',
  phases: [
    {
      icon: 'ScanSearch',
      phase: 'Pre-deal',
      title: 'See every asset, priced for risk',
      body: 'Revenue, technology, delivery, contracts and human capital in one view, each finding priced against your risk tolerance.',
    },
    {
      icon: 'Handshake',
      phase: 'During the deal',
      title: 'Negotiate the whole deal from evidence',
      body: 'Accepted risks flow into Sextant’s scenarios, the purchase-price bridge, escrows and indemnities, every term traceable to its source.',
    },
    {
      icon: 'ShieldCheck',
      phase: 'Post-merger',
      title: 'Track and protect what you bought',
      body: 'A hundred-day plan tied to what diligence found, with key people, retention and integration risks tracked until the value is secure.',
    },
  ],
  signoff: 'The cheapest price is rarely the best deal. The right price for an excellent business is.',
} as const;

/* ------------------------------------------------------------------------ */
/* Pricing (ADR 0025)                                                        */
/* ------------------------------------------------------------------------ */

export interface Plan {
  readonly id: 'pact' | 'team' | 'venture-raise' | 'firm';
  readonly icon: IconName;
  readonly name: string;
  readonly audience: string;
  /** Display price; null means "talk to us". */
  readonly price: string | null;
  readonly cadence: string;
  readonly alternatives: readonly string[];
  readonly includes: readonly string[];
  readonly highlighted?: boolean;
}

/** The launch price book (ADR 0025), in US dollars. Mirrors the app's billing plans. */
export const PLANS: readonly Plan[] = [
  {
    id: 'pact',
    icon: 'Target',
    name: 'Pact',
    audience: 'One acquisition, start to close',
    price: '$2,500',
    cadence: 'per pact, one-time',
    alternatives: [],
    includes: [
      'Every module, from evidence to close',
      'Live for 12 months, then read-only for good',
      'Reports, Sextant valuation and two-sided close',
      'Pactlab in your AI assistant',
      'Unlimited users; counterparty guests free',
    ],
  },
  {
    id: 'team',
    icon: 'Users',
    name: 'Team',
    audience: 'Buyers running deals every quarter',
    price: '$1,500',
    cadence: 'a month, billed yearly ($18,000)',
    alternatives: ['$1,800 billed monthly'],
    includes: ['10 pacts a year', 'Extra pacts $1,500 each', 'Executive report across every deal', 'Everything in Pact', 'Unlimited users; counterparty guests free'],
    highlighted: true,
  },
  {
    id: 'venture-raise',
    icon: 'Rocket',
    name: 'Venture Raise',
    audience: 'Founders preparing a round',
    price: '$99',
    cadence: 'a month',
    alternatives: ['$990 a year', '$500 per round'],
    includes: ['The readiness screen is free', 'See what an investor will find, first', 'Cap table, SAFEs and investor views', 'Share a view with nothing confidential in it'],
  },
  {
    id: 'firm',
    icon: 'Landmark',
    name: 'Firm and Enterprise',
    audience: 'Funds, corporate development and advisors',
    price: null,
    cadence: 'talk to us',
    alternatives: [],
    includes: ['Higher pact volumes', 'Company single sign-on', 'Sell-side pacts for running a sale', 'Invoice billing and priority support', 'Confidential data in your AI assistant'],
  },
];

export const PRICING = {
  title: 'Priced per deal. Unlimited users.',
  body:
    'A buyer already spends tens of thousands on a quality-of-earnings report and far more on third-party diligence. Pactlab is priced per pact, ' +
    'with a subscription for teams that buy often. Everyone on your team, and everyone you invite from the other side, is included.',
  notes: [
    { icon: 'Users', title: 'Unlimited users', body: 'No seat counting. Bring the whole deal team, your advisors and the reviewers.' },
    { icon: 'Handshake', title: 'Guests are free', body: 'People you invite from the other side of the deal never need a plan.' },
    { icon: 'Lock', title: 'Your record stays yours', body: 'When a pact’s live period ends it becomes read-only, never deleted.' },
    { icon: 'Tag', title: 'Promo codes', body: 'Have a code from us? Enter it when you sign up for a discount or free pacts.' },
    { icon: 'Gift', title: 'Pilots', body: 'Design partners run a live deal free while their pilot agreement runs.' },
    { icon: 'Receipt', title: 'Currency and tax', body: 'Prices are in US dollars before tax. UK and EU businesses account for VAT under the reverse charge.' },
  ],
} as const satisfies { title: string; body: string; notes: readonly Feature[] };
