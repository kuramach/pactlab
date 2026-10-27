/**
 * Answer-shaped pages (T-085 Part 3): FAQs for the three audiences,
 * question-titled guides and one comparison. Same voice rules as the rest of
 * the site — present tense, no invented statistics or customers — and every
 * claim about another product comes from that product's public pages.
 */

export interface QA {
  readonly q: string;
  readonly a: string;
}

export interface FaqPage {
  readonly slug: string;
  readonly audience: string;
  readonly title: string;
  readonly description: string;
  readonly items: readonly QA[];
  /** Pages to read next, by site path. */
  readonly related: readonly { readonly href: string; readonly label: string }[];
}

export const FAQS: readonly FaqPage[] = [
  {
    slug: 'acquirers',
    audience: 'Acquirers',
    title: 'AI due diligence for acquirers: questions and answers',
    description: 'How AI-assisted diligence works on a software or SaaS acquisition, what Pactlab checks, and where a person still decides.',
    items: [
      {
        q: 'How does AI due diligence work on a software acquisition?',
        a: 'Pactlab reads the evidence directly: the billing export, the code repository and its history, the issue tracker and the documents in the data room. It rebuilds recurring revenue from billing records, reads ownership and licence exposure from the repository, and extracts contract terms with page-level citations. AI drafts findings from that evidence; a named reviewer accepts, rejects or asks for support. Calculations such as ARR, retention and valuation are deterministic code, not model output.',
      },
      {
        q: 'What does Pactlab check that a data room does not?',
        a: 'A data room stores documents. Pactlab tests what they claim. It compares what management reports — ARR, churn, runway, headcount — with what the billing records, the repository and the contracts show, and records each comparison in a claims register as confirmed, contradicted or unverified, with the source of both sides.',
      },
      {
        q: 'Can the AI approve a finding or set the price?',
        a: 'No. AI extracts, classifies, compares and drafts. A finding becomes accepted only when a person accepts it, and an AI finding without a resolvable citation cannot be accepted at all. Prices come from valuation scenarios built on versioned assumptions that a person approves.',
      },
      {
        q: 'How do findings change the valuation?',
        a: 'An accepted, priced finding links to the valuation as an adjustment on the price bridge. If the finding or its evidence changes, every scenario that depends on it is marked stale until it is re-run, so the price never silently rests on a finding that has moved.',
      },
      {
        q: 'Does Pactlab keep the target’s source code?',
        a: 'No. Code is read in an isolated, short-lived workspace that is destroyed afterwards. Pactlab keeps normalized findings, file paths, hashes and tool versions — not the source.',
      },
      {
        q: 'How is the target’s people data handled?',
        a: 'People appear as aggregates by default. Named views are gated, reads are audited, small groups are suppressed, and HR, compensation and named contribution data are never sent to an AI model.',
      },
      {
        q: 'Which industries does Pactlab cover?',
        a: 'Software and SaaS is the core. Industry packs add the sources, checks and valuation methods for fintech, healthcare services, hospitals, small clinics, telecom and media, professional services, pharma and biotech, e-commerce, multifamily, commercial property and hotels. Each pack keeps the same review and citation rules.',
      },
    ],
    related: [
      { href: '/guides/saas-acquisition-due-diligence', label: 'Guide: how to run due diligence on a SaaS acquisition' },
      { href: '/guides/technical-due-diligence-with-ai', label: 'Guide: technical due diligence with AI' },
      { href: '/product', label: 'The six product modules' },
    ],
  },
  {
    slug: 'founders',
    audience: 'Founders',
    title: 'Preparing for investor diligence: questions founders ask',
    description: 'How a founder prepares for VC due diligence, what investors check in a seed round, and how Pactlab’s Venture Raise helps you see it first.',
    items: [
      {
        q: 'How do I prepare for VC due diligence?',
        a: 'Check your own claims against your own records before an investor does. The usual gaps are a deck ARR that billing does not support, a runway calculated on an old burn rate, SAFEs that convert into more of the company than you expect, and contractor work without an IP assignment. Venture Raise runs those checks on your billing export, cap table, monthly financials and documents, and shows each gap with its source.',
      },
      {
        q: 'What do investors check in a seed round?',
        a: 'Typically: revenue and its quality, burn and runway, the cap table and how outstanding SAFEs and notes convert, ownership of the IP, the founders’ vesting and tax elections, key contracts, and board composition after the round. Pactlab’s readiness checklist shows which of these your data room already answers for an angel and for a venture fund.',
      },
      {
        q: 'How do I compare term sheets from several investors?',
        a: 'Record each offer — pre-money, amount, pool target, liquidation preference, board seats — on the Raise tab. Pactlab models the round for each one, including SAFE conversion and the option-pool shuffle, and shows price per share and founder ownership side by side.',
      },
      {
        q: 'What does an investor see if I share my Pactlab workspace?',
        a: 'Only the investor view you choose to share: verified numbers and the documents you select. Your findings, runway analysis and the other offers stay on your side.',
      },
      {
        q: 'Does Pactlab tell me what my company is worth?',
        a: 'It models what each offer means for your ownership and checks the evidence behind your numbers. The valuation itself is what you and your investors agree; Pactlab never sets it.',
      },
    ],
    related: [
      { href: '/guides/prepare-for-vc-due-diligence', label: 'Guide: how to prepare for VC due diligence' },
      { href: '/industries/venture-raise', label: 'Venture Raise' },
    ],
  },
  {
    slug: 'advisors',
    audience: 'Deal advisors',
    title: 'Pactlab for deal advisors: questions and answers',
    description: 'How M&A advisors, bankers and diligence providers use Pactlab to evidence their work and keep every number traceable.',
    items: [
      {
        q: 'How does Pactlab fit an advisor’s diligence process?',
        a: 'Pactlab is the workspace where evidence, findings and valuation stay connected. You load the client’s or target’s billing export, repository, issue tracker and documents; Pactlab drafts findings with citations; you review them; accepted findings flow into valuation scenarios and proposed deal terms.',
      },
      {
        q: 'Can every number in a report be traced back?',
        a: 'Yes. Each figure resolves to the evidence it came from — a billing line, a commit, a document page — and each accepted finding records who accepted it and when.',
      },
      {
        q: 'Are client deals kept separate?',
        a: 'Yes. Every deal row carries its organization and deal identity, and isolation is enforced in the database with row-level security, not only in the interface. Target contributors never see buyer-only findings, valuation or negotiation terms unless they are explicitly shared.',
      },
      {
        q: 'Which valuation methods are available?',
        a: 'ARR multiple and discounted cash flow for software, plus pack methods where the sector needs them: NOI and cap rate for property, payer-mix-adjusted EBITDA for hospitals, and round pre-money for founders raising. Each scenario stores its assumptions as a version.',
      },
      {
        q: 'Can we use our own data templates?',
        a: 'Billing exports from common systems map through column matching onto Pactlab’s standard template, and each industry pack publishes a CSV template for its extracts, such as a rent roll or a loan tape.',
      },
    ],
    related: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/compare/valuation-software', label: 'Pactlab compared with valuation software' },
      { href: '/trust', label: 'Trust and security' },
    ],
  },
];

export interface GuideSection {
  readonly heading: string;
  readonly body?: string;
  readonly points?: readonly string[];
}

export interface Guide {
  readonly slug: string;
  /** The question, as people ask it. */
  readonly title: string;
  readonly description: string;
  readonly intro: string;
  readonly sections: readonly GuideSection[];
  /** The pack page and other pages this guide leads to. */
  readonly related: readonly { readonly href: string; readonly label: string }[];
}

export const GUIDES: readonly Guide[] = [
  {
    slug: 'saas-acquisition-due-diligence',
    title: 'How do you run due diligence on a SaaS acquisition?',
    description: 'A practical checklist for SaaS acquisition due diligence: revenue, retention, contracts, code and valuation — and how to keep each finding tied to its evidence.',
    intro:
      'SaaS diligence comes down to one question: does the evidence support the number you are about to pay? Work from the source records, not the summaries, and let every finding carry its citation into the price.',
    sections: [
      {
        heading: '1. Rebuild recurring revenue from billing',
        body: 'Management ARR is a claim. Rebuild MRR and ARR from invoice lines in the billing export, then reconcile the two and explain the difference.',
        points: [
          'Annualize the latest month from billing, not from a pipeline or bookings report.',
          'Separate new, expansion, contraction and churn by month.',
          'Look for contraction hidden behind a stable logo count.',
          'Measure customer concentration: the share of revenue from the largest customers.',
        ],
      },
      {
        heading: '2. Test retention by cohort',
        points: [
          'Net and gross revenue retention by signup cohort, not one blended figure.',
          'Whether recent cohorts behave like older ones.',
          'Which customers drive the net expansion.',
        ],
      },
      {
        heading: '3. Read the contracts that move the price',
        points: [
          'Change-of-control and termination-for-convenience clauses in the largest customer contracts.',
          'Price-review and most-favoured-customer terms.',
          'Debt and debt-like items on the balance sheet.',
        ],
      },
      {
        heading: '4. Check the code and the team behind it',
        body: 'Read the repository history for ownership and key-person risk, licence exposure, and whether delivery matches the roadmap. See the technical diligence guide for the detail.',
      },
      {
        heading: '5. Keep a claims register',
        body: 'List what the seller says — ARR, churn, headcount, runway — next to what the evidence shows, and mark each as confirmed, contradicted or unverified. A contradicted claim is usually a finding.',
      },
      {
        heading: '6. Price what you find',
        body: 'Value with an ARR multiple and a DCF on reconciled numbers. Link each accepted, priced finding to the price bridge as an adjustment, so the gap between the asking price and the supported value is explained line by line.',
      },
      {
        heading: 'How Pactlab does it',
        body: 'Pactlab imports the billing export, rebuilds the revenue ledger, reads the repository and documents, and drafts findings with citations. A named reviewer accepts or rejects each one; accepted findings flow into versioned valuation scenarios and the price bridge.',
      },
    ],
    related: [
      { href: '/industries/software-saas', label: 'Software and SaaS diligence' },
      { href: '/product/revenue', label: 'Revenue and SaaS metrics' },
      { href: '/product/valuation', label: 'Sextant: valuation and deal terms' },
    ],
  },
  {
    slug: 'technical-due-diligence-with-ai',
    title: 'How do you do technical due diligence on a software acquisition with AI?',
    description: 'What technical due diligence covers — code ownership, licences, delivery health and key-person risk — and how AI can read the evidence while people make the calls.',
    intro:
      'Technical diligence asks whether the product can keep being built after the deal closes, by whom, and at what risk. AI is useful for reading large histories quickly; the judgments stay with people.',
    sections: [
      {
        heading: 'What to read',
        points: [
          'Commit history: who works on which parts of the code, and how that has changed.',
          'Ownership: areas with a single maintainer, and contributors who have left.',
          'Dependencies and licences: copyleft or unknown licences in shipped code.',
          'Delivery: sprint commitments versus completion, cycle time and reopened work.',
          'Pull requests and reviews: whether changes are reviewed before they ship.',
        ],
      },
      {
        heading: 'Where AI helps',
        body: 'Reading thousands of commits, issues and pull requests, grouping them by code area, and drafting findings such as “one person owns the billing service”. Every drafted finding must cite the commits or issues behind it.',
      },
      {
        heading: 'Where people decide',
        body: 'Whether a key-person dependency matters, what a retention plan should be, and how a risk is priced. People data needs care: use aggregates by default, gate named views, and never send compensation or performance data to a model.',
      },
      {
        heading: 'Keep the source code out of the file',
        body: 'Scan in an isolated, short-lived workspace and keep only findings, paths, hashes and tool versions. Diligence does not need a copy of the target’s code.',
      },
      {
        heading: 'How Pactlab does it',
        body: 'Pactlab connects to GitHub and Jira, reads metadata and history, and shows ownership, delivery health and key-person risk at team scale. Findings carry their citations into review and, once accepted and priced, into valuation.',
      },
    ],
    related: [
      { href: '/product/technology', label: 'Technology and code' },
      { href: '/product/delivery', label: 'Delivery health' },
      { href: '/industries/software-saas', label: 'Software and SaaS diligence' },
    ],
  },
  {
    slug: 'prepare-for-vc-due-diligence',
    title: 'How should a founder prepare for VC due diligence?',
    description: 'A founder’s checklist for investor due diligence: check ARR, runway, the cap table, SAFEs and IP against your own records before an investor does.',
    intro:
      'Investors test what your deck says against your records. Run the same test first, fix what you can, and explain what you cannot — before it becomes a negotiating point.',
    sections: [
      {
        heading: 'Check your numbers against your records',
        points: [
          'ARR in the deck versus ARR from your billing system for the latest month.',
          'Runway in the deck versus cash divided by the last three months’ net burn.',
          'Customer concentration: how much revenue your largest customers represent.',
        ],
      },
      {
        heading: 'Check your cap table',
        points: [
          'Issued shares match the certificate of incorporation and board consents.',
          'Every SAFE and note: cap, discount and most-favoured-nation terms — an MFN clause can convert an early SAFE on a later, lower cap.',
          'The option pool the investor will ask for, and whether it comes out of the pre-money.',
        ],
      },
      {
        heading: 'Check ownership of what you built',
        points: [
          'IP assignment in every founder, employee and contractor agreement.',
          'Founder vesting and tax elections on file.',
        ],
      },
      {
        heading: 'Compare offers on what you keep',
        body: 'For each term sheet, model the round: price per share, SAFE conversion, pool and founder ownership after closing. The headline pre-money is not the whole answer.',
      },
      {
        heading: 'How Pactlab does it',
        body: 'Venture Raise imports your billing export, cap table and monthly financials, reads your documents, and flags each gap with its source. The Raise tab models every offer side by side, and the investor view shares only the verified numbers you choose.',
      },
    ],
    related: [
      { href: '/industries/venture-raise', label: 'Venture Raise' },
      { href: '/faq/founders', label: 'Founder questions and answers' },
    ],
  },
];

export interface Comparison {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly intro: string;
  readonly them: string;
  readonly rows: readonly { readonly topic: string; readonly them: string; readonly pactlab: string }[];
  readonly conclusion: string;
  readonly sources: readonly { readonly href: string; readonly label: string }[];
}

export const COMPARISONS: readonly Comparison[] = [
  {
    slug: 'valuation-software',
    title: 'Pactlab compared with M&A valuation software',
    description: 'How Pactlab differs from valuation and deal-modelling software such as MoneySoft DealSense: evidence-first diligence with findings that flow into the price.',
    intro:
      'Valuation software models a deal from the financial statements you enter. Pactlab starts earlier: it tests the evidence behind those statements, records what it finds, and carries the accepted findings into the valuation. The two answer different questions, and many teams use both.',
    them: 'MoneySoft DealSense',
    rows: [
      {
        topic: 'Starting point',
        them: 'Historic financial statements entered by the user or imported from Excel or CSV.',
        pactlab: 'Source records: billing exports, code repositories, issue trackers, documents and industry extracts.',
      },
      {
        topic: 'Diligence findings',
        them: 'Not described on its product page.',
        pactlab: 'Drafts findings from the evidence, each with a citation; a named reviewer accepts, rejects or asks for support.',
      },
      {
        topic: 'Valuation',
        them: 'Business valuation, deal pricing and structuring, projections, ROI and accretion/dilution analysis.',
        pactlab: 'Versioned scenarios (ARR multiple, DCF and sector methods) with accepted findings linked to the price bridge.',
      },
      {
        topic: 'Code and delivery',
        them: 'Not described on its product page.',
        pactlab: 'Reads repository history and issue trackers for ownership, licences and delivery health; never keeps the source code.',
      },
      {
        topic: 'Comparable deal data',
        them: 'Optional integrations with databases such as DealStats, BIZCOMPS and RMA Annual Statement Studies.',
        pactlab: 'Comparables recorded with their source, alongside the evidence-based scenarios.',
      },
      {
        topic: 'Reports',
        them: 'Appraisals, pitchbooks and CIMs, acquisition proposals and term sheets.',
        pactlab: 'Findings, the claims register, valuation scenarios and proposed deal terms, each traceable to evidence.',
      },
      {
        topic: 'Where it runs',
        them: 'Windows desktop, or a Windows remote desktop, terminal or Citrix server.',
        pactlab: 'In the browser, with each deal isolated by row-level security in the database.',
      },
    ],
    conclusion:
      'Use valuation software to model a deal from agreed financials. Use Pactlab to establish which financials the evidence supports, what risks it shows, and how those findings change the price — with a person signing off each step.',
    sources: [{ href: 'https://moneysoft.com/valuation-and-acquisition-analysis-software/', label: 'MoneySoft: DealSense product page' }],
  },
];
