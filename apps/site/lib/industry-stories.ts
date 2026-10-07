/**
 * Marketing layer for the industry pages. Same voice rules as content.ts:
 * direct, no hype, no statistics or customer claims. Walkthroughs and example
 * findings are illustrative and labelled so on the page; planned packs say
 * plainly that they are planned.
 */
import type { Feature } from './content';

export interface ExampleFinding {
  readonly title: string;
  readonly severity: 'High' | 'Medium';
  /** The evidence it rests on. */
  readonly evidence: string;
  /** What it becomes in the deal. */
  readonly term: string;
}

export interface IndustryStory {
  /** Big marketing headline for the hero. */
  readonly headline: string;
  readonly subhead: string;
  /** Alt text for the illustration. */
  readonly illustrationAlt: string;
  /** What keeps the deal team up at night. */
  readonly pains: readonly Feature[];
  /** Illustrative run through the decision loop. */
  readonly walkthrough: readonly { readonly step: string; readonly text: string }[];
  readonly findings: readonly ExampleFinding[];
  readonly deliverables: readonly Feature[];
  readonly faq: readonly { readonly q: string; readonly a: string }[];
}

const PLANNED_FAQ = (sector: string) => ({
  q: `Can we use Pactlab for a ${sector} deal today?`,
  a: `The ${sector} pack is planned, not built. Pactlab is proving its software baseline with pilot customers first. If the target has a software business, the software modules apply today — and design partners in ${sector} help decide what the pack reads and checks first.`,
});

export const INDUSTRY_STORIES: Readonly<Record<string, IndustryStory>> = {
  'software-saas': {
    headline: 'Know the ARR is real before you pay a multiple on it.',
    subhead:
      'Software deals are priced on recurring revenue and on a codebase most buyers never read. Pactlab checks both from the source, and every finding a reviewer accepts flows straight into the price.',
    illustrationAlt: 'Illustration of an application window with code, a rising ARR chart and a commit graph.',
    pains: [
      { icon: 'ChartLine', title: 'ARR that only exists in the deck', body: 'Management ARR rarely matches billing to the dollar, and the gap is where price risk hides.' },
      { icon: 'UserRound', title: 'One engineer holding the product', body: 'Interviews describe the team; the commit history shows who actually builds what.' },
      { icon: 'FileCode', title: 'Licences that come along for the ride', body: 'Copyleft components in a shipped product can change what you are buying.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Billing exports, the repository and the delivery tracker are connected for the deal. Every record is hashed and kept with its source.' },
      { step: 'Finding', text: 'Billed ARR falls short of the data book; a scanner flags a copyleft dependency; commit history shows one engineer behind the billing system.' },
      { step: 'Review', text: 'A reviewer accepts the ARR gap with the bridge attached and asks for support on the licence finding before deciding.' },
      { step: 'Valuation', text: 'The accepted risks become priced adjustments; the scenario re-runs and shows exactly how the price moved and why.' },
      { step: 'Deal terms', text: 'The ARR gap becomes a price adjustment and the licence exposure an indemnity, each linked to its evidence.' },
    ],
    findings: [
      { title: 'Management ARR exceeds billed ARR', severity: 'High', evidence: 'Invoice lines reconciled to the reported ARR figure', term: 'Purchase-price adjustment' },
      { title: 'Copyleft component in the shipped agent', severity: 'High', evidence: 'Software bill of materials at the scanned commit', term: 'Specific indemnity and remediation plan' },
      { title: 'Billing subsystem depends on one contributor', severity: 'Medium', evidence: 'Commit history, aggregated by subsystem', term: 'Retention arrangement in the integration plan' },
    ],
    deliverables: [
      { icon: 'ArrowLeftRight', title: 'An approved ARR bridge', body: 'From the deck to the ledger, with the difference signed off.' },
      { icon: 'ClipboardList', title: 'A priced risk register', body: 'Every accepted finding with its evidence, reviewer and price range.' },
      { icon: 'Snowflake', title: 'A frozen valuation', body: 'Submitted, approved by a second person and never rewritten.' },
    ],
    faq: [
      { q: 'Does Pactlab keep our target’s source code?', a: 'No. Repositories are scanned in short-lived workspaces that are destroyed afterwards. Findings keep paths, hashes and tool versions — never code.' },
      { q: 'Who decides what is a real risk?', a: 'Your reviewers. Analysts, scanners and models can draft findings; only a named person can accept them, and nothing reaches the valuation until they do.' },
      { q: 'What do we need to start?', a: 'One live deal, access to its billing, code, delivery and documents, and the people who will review. That is what a pilot is.' },
    ],
  },

  fintech: {
    headline: 'Fintech is a software deal with a regulator in the room.',
    subhead:
      'The technology diligence is the software baseline. The fintech pack adds what decides the price in financial services: the compliance programme, the regulators and the quality of the book.',
    illustrationAlt: 'Illustration of a payment card, a bank building and a shield, connected by a transaction flow.',
    pains: [
      { icon: 'ShieldAlert', title: 'A compliance programme that is better on paper', body: 'AML controls described in policy are not the controls that run every day.' },
      { icon: 'Landmark', title: 'Regulators you inherit at closing', body: 'Open matters with banking regulators travel with the business.' },
      { icon: 'Wallet', title: 'A loan book priced on its best month', body: 'Credit quality and the allowance behind it move value more than any multiple.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Core-banking and payment records, compliance artefacts and partner-bank agreements join the usual software sources.' },
      { step: 'Finding', text: 'Regulatory, AML and loan-book findings are drafted next to the technology findings — each citing its records.' },
      { step: 'Review', text: 'Compliance and credit reviewers decide them in the same workflow as the technology team.' },
      { step: 'Valuation', text: 'Regulatory-capital and credit-quality adjustments sit alongside the ARR and DCF scenarios.' },
      { step: 'Deal terms', text: 'Escrows, indemnities and conditions precedent tied to the exact findings that justified them.' },
    ],
    findings: [
      { title: 'Transaction-monitoring alerts closed without review evidence', severity: 'High', evidence: 'Alert records against the written AML procedure', term: 'Remediation covenant and special indemnity' },
      { title: 'Allowance below observed loss experience', severity: 'High', evidence: 'Loan-level performance data', term: 'Credit-quality price adjustment' },
      { title: 'Partner-bank agreement terminable on change of control', severity: 'Medium', evidence: 'Clause cited from the agreement', term: 'Consent as a closing condition' },
    ],
    deliverables: [
      { icon: 'ShieldCheck', title: 'A compliance view with evidence', body: 'Findings tied to records, not to policy documents alone.' },
      { icon: 'Wallet', title: 'A credit view of the book', body: 'Quality and allowance analysis feeding the valuation.' },
      { icon: 'Handshake', title: 'Terms that match the risk', body: 'Each protection traceable to a reviewed finding.' },
    ],
    faq: [
      PLANNED_FAQ('fintech'),
      { q: 'Why is fintech first after the baseline?', a: 'Fintech targets are technology companies. Security, compliance, open-source and contract review carry over almost one to one, so the distance from today’s product is shortest.' },
    ],
  },

  healthcare: {
    headline: 'In healthcare roll-ups, reimbursement is the revenue.',
    subhead:
      'Payer mix, coding and referral arrangements decide what a practice is worth. The healthcare pack brings that evidence into the same review and valuation loop the software baseline uses.',
    illustrationAlt: 'Illustration of a clinic building, a heartbeat line and a claims checklist.',
    pains: [
      { icon: 'Stethoscope', title: 'Revenue that depends on a rate schedule', body: 'A shift in payer mix or a government rate change reprices the whole roll-up.' },
      { icon: 'Scale', title: 'Referral arrangements that need a second look', body: 'Compensation and referral relationships carry legal risk long after closing.' },
      { icon: 'UserRound', title: 'Clinicians who are the business', body: 'A practice can depend on a few providers — and their credentials.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Reimbursement and claims data, payer contracts, compliance artefacts and provider credentials, alongside the financials.' },
      { step: 'Finding', text: 'Reimbursement, coding, referral and privacy findings are drafted with citations to the records behind them.' },
      { step: 'Review', text: 'Clinical, compliance and financial reviewers decide in one workflow, each decision recorded.' },
      { step: 'Valuation', text: 'Payer-mix and reimbursement-rate sensitivities run against the same scenario engine.' },
      { step: 'Deal terms', text: 'Indemnities, escrows and earn-out conditions tied to the reimbursement and compliance findings.' },
    ],
    findings: [
      { title: 'Revenue concentrated in one government programme', severity: 'High', evidence: 'Claims and remittance data by payer', term: 'Rate-sensitivity case in the valuation' },
      { title: 'Medical-director arrangement above documented duties', severity: 'High', evidence: 'Agreement cited against time records', term: 'Specific indemnity; restructure before closing' },
      { title: 'Privacy risk assessment out of date', severity: 'Medium', evidence: 'Most recent assessment and system inventory', term: 'Pre-closing remediation covenant' },
    ],
    deliverables: [
      { icon: 'Stethoscope', title: 'A reimbursement picture', body: 'Payer mix and rate exposure, from claims data.' },
      { icon: 'ShieldPlus', title: 'A compliance register', body: 'Referral, coding and privacy findings with their evidence.' },
      { icon: 'Percent', title: 'Rate-aware valuation', body: 'Scenarios that show what a rate change does to price.' },
    ],
    faq: [
      PLANNED_FAQ('healthcare'),
      { q: 'Does this involve patient data?', a: 'The pack is designed around reimbursement, contract and compliance evidence. Pactlab defaults to aggregates and keeps sensitive personal data away from models; specific handling would be defined in the pack’s specification before it is built.' },
    ],
  },

  'telecom-media': {
    headline: 'Subscribers are recurring revenue with a different name.',
    subhead:
      'ARPU, churn and subscriber cohorts are the metrics Pactlab already computes for SaaS. The telecom and media pack changes the labels and the sources — not the mathematics.',
    illustrationAlt: 'Illustration of a broadcast tower, a video player and a row of subscribers.',
    pains: [
      { icon: 'Signal', title: 'Subscriber counts that do not reconcile', body: 'Reported subscribers and billed subscribers drift apart quietly.' },
      { icon: 'Repeat', title: 'Churn hidden in the average', body: 'A healthy blended churn rate can hide one plan or region in decline.' },
      { icon: 'ChartPie', title: 'Concentration by region or channel', body: 'One distribution partner or region can carry more of the base than it seems.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Subscriber billing and plan data, plus the KPIs the seller reports.' },
      { step: 'Finding', text: 'Gaps between reported and billed subscribers, and churn by cohort and plan, are drafted with the rows behind them.' },
      { step: 'Review', text: 'Reviewers accept or reject each with a rationale.' },
      { step: 'Valuation', text: 'Churn- and ARPU-driven inputs feed the same scenario and sensitivity engine.' },
      { step: 'Deal terms', text: 'Price adjustments tied to the reconciled subscriber base.' },
    ],
    findings: [
      { title: 'Reported subscribers exceed billed subscribers', severity: 'High', evidence: 'Subscriber billing reconciled to reported counts', term: 'Price adjusted to the billed base' },
      { title: 'Churn rising in the newest cohorts', severity: 'Medium', evidence: 'Cohort retention from billing history', term: 'Downside case in the valuation' },
    ],
    deliverables: [
      { icon: 'ArrowLeftRight', title: 'A reconciled subscriber base', body: 'Reported against billed, with the difference approved.' },
      { icon: 'CalendarRange', title: 'Cohorts and churn by plan', body: 'Where the base is strengthening and where it is not.' },
      { icon: 'SlidersHorizontal', title: 'ARPU and churn scenarios', body: 'Inputs that move price, run deterministically.' },
    ],
    faq: [
      PLANNED_FAQ('telecom and media'),
      { q: 'How different is this from SaaS?', a: 'Less than it looks: ARPU is MRR per account, subscriber churn is logo churn, subscriber cohorts are revenue cohorts. The pack mainly adds subscriber-billing sources and sector definitions.' },
    ],
  },

  'professional-services': {
    headline: 'In a services business, the people are the product.',
    subhead:
      'Utilization, attrition and client concentration decide what an agency or consultancy is worth. The services pack measures them from timesheets and contracts — in aggregate, with people data protected.',
    illustrationAlt: 'Illustration of a briefcase, a utilization chart and a small team shown in aggregate.',
    pains: [
      { icon: 'Activity', title: 'Utilization measured by optimism', body: 'Billable hours in the management pack rarely match the timesheets.' },
      { icon: 'UserMinus', title: 'Attrition after the announcement', body: 'Key people leave when a deal closes, and revenue follows them.' },
      { icon: 'ChartPie', title: 'Two clients, most of the revenue', body: 'Concentration and contract terms decide how durable revenue really is.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Timesheet and professional-services data, client contracts and the financials.' },
      { step: 'Finding', text: 'Utilization, bench cost, attrition and concentration findings — reported in aggregate, never as rankings of people.' },
      { step: 'Review', text: 'Reviewers decide each with its evidence in front of them.' },
      { step: 'Valuation', text: 'Earnings-quality adjustments for people-driven revenue run in the same engine.' },
      { step: 'Deal terms', text: 'Earn-outs, retention arrangements and price adjustments tied to the findings.' },
    ],
    findings: [
      { title: 'Utilization below the level the plan assumes', severity: 'High', evidence: 'Timesheets against reported utilization', term: 'Earnings-quality adjustment' },
      { title: 'Largest client terminable for convenience', severity: 'High', evidence: 'Clause cited from the master services agreement', term: 'Earn-out linked to renewal' },
      { title: 'Rising attrition in delivery roles', severity: 'Medium', evidence: 'Aggregate headcount movements', term: 'Retention plan in the first 100 days' },
    ],
    deliverables: [
      { icon: 'Activity', title: 'Utilization you can defend', body: 'From timesheets, not from the management pack.' },
      { icon: 'ChartPie', title: 'Client concentration and terms', body: 'Who the revenue depends on, and how it can end.' },
      { icon: 'Award', title: 'Quality-of-earnings adjustments', body: 'Applied to the valuation with their basis stated.' },
    ],
    faq: [
      PLANNED_FAQ('professional services'),
      { q: 'How is people data handled?', a: 'In aggregate by default. Named and compensation data stay gated and audited, and are never sent to a model — the same rules as the rest of Pactlab.' },
    ],
  },

  'pharma-biotech': {
    headline: 'The largest deals rest on the most specialized evidence.',
    subhead:
      'Clinical data, regulatory pathways, patent expiries and manufacturing quality decide pharma and biotech value. The pack plugs that evidence into the same review and valuation core — with exact citations throughout.',
    illustrationAlt: 'Illustration of a DNA helix, a capsule and a patent document with a calendar.',
    pains: [
      { icon: 'Microscope', title: 'Clinical evidence read through a summary', body: 'What the data supports and what the deck says can differ.' },
      { icon: 'FileCheck', title: 'An approval path with open questions', body: 'Regulatory risk is binary and lands on the timeline and the price.' },
      { icon: 'Pill', title: 'A patent cliff inside the forecast', body: 'Exclusivity dates decide when revenue falls away.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Trial registries, regulatory filings, patent data and manufacturing records join the document set.' },
      { step: 'Finding', text: 'Clinical, regulatory, patent and quality findings are drafted with exact citations to filings and protocols.' },
      { step: 'Review', text: 'Scientific, regulatory and legal reviewers decide in one workflow.' },
      { step: 'Valuation', text: 'Approval timing and exclusivity feed the scenarios the deal team runs.' },
      { step: 'Deal terms', text: 'Milestones, contingent payments and indemnities tied to the findings.' },
    ],
    findings: [
      { title: 'Key patent expires earlier than the forecast assumes', severity: 'High', evidence: 'Patent record and the revenue forecast', term: 'Revised exclusivity case in the valuation' },
      { title: 'Open manufacturing observations at a supplier site', severity: 'Medium', evidence: 'Inspection records cited', term: 'Supply-continuity covenant' },
    ],
    deliverables: [
      { icon: 'Microscope', title: 'Cited clinical and regulatory findings', body: 'Every claim tied to the filing or protocol it came from.' },
      { icon: 'Pill', title: 'An exclusivity timeline', body: 'Patent and exclusivity dates in the valuation, not in an appendix.' },
      { icon: 'Handshake', title: 'Milestone-based terms', body: 'Contingent consideration linked to the risks behind it.' },
    ],
    faq: [
      PLANNED_FAQ('pharma and biotech'),
      { q: 'Why is it fifth, given the deal sizes?', a: 'Almost none of today’s evidence sources or finding types apply, so it is the largest build. The core — evidence, review, citations and valuation — carries over unchanged.' },
    ],
  },

  'ecommerce-dtc': {
    headline: 'Brands are worth what their customers come back for.',
    subhead:
      'Acquisition cost, repeat purchase and channel dependence decide what a consumer brand is worth. Pactlab’s cohort and concentration engine already measures them — the pack adds storefront and ad-platform sources.',
    illustrationAlt: 'Illustration of a storefront, a shopping bag with a repeat arrow and repeat purchase by cohort.',
    pains: [
      { icon: 'Megaphone', title: 'Acquisition cost that keeps rising', body: 'Blended CAC hides channels that no longer pay back.' },
      { icon: 'Repeat', title: 'Repeat purchase that fades by cohort', body: 'Lifetime value built on early cohorts may not hold for later ones.' },
      { icon: 'Store', title: 'One marketplace holding the brand', body: 'Channel concentration is platform risk you inherit.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Storefront and marketplace orders, ad-platform spend and supplier terms.' },
      { step: 'Finding', text: 'CAC, LTV, repeat-purchase and channel findings are drafted from the order and spend data.' },
      { step: 'Review', text: 'Reviewers decide each with the cohort rows in view.' },
      { step: 'Valuation', text: 'Valuation methods apply unchanged, with unit-economics inputs.' },
      { step: 'Deal terms', text: 'Price adjustments and earn-outs linked to the unit economics.' },
    ],
    findings: [
      { title: 'Repeat purchase declining in recent cohorts', severity: 'High', evidence: 'Order history by first-purchase month', term: 'Lifetime-value case in the valuation' },
      { title: 'Majority of revenue through one marketplace', severity: 'Medium', evidence: 'Orders by channel', term: 'Channel-risk adjustment' },
    ],
    deliverables: [
      { icon: 'Target', title: 'Unit economics from the source', body: 'CAC and LTV from orders and spend, not from a summary.' },
      { icon: 'CalendarRange', title: 'Cohorts that show the trend', body: 'Repeat purchase by first-purchase month.' },
      { icon: 'ChartPie', title: 'Channel dependence', body: 'Where the revenue comes from, and how concentrated it is.' },
    ],
    faq: [PLANNED_FAQ('e-commerce and DTC')],
  },
};
