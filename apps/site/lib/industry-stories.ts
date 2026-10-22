/**
 * Marketing layer for the industry pages. Same voice rules as content.ts:
 * direct, no hype, no statistics or customer claims. Walkthroughs and example
 * findings are illustrative and labelled so on the page. Every pack is written
 * as available, in the present tense.
 */
import { INDUSTRIES, type Feature } from './content';

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
      { q: 'Does the software diligence still run on a fintech target?', a: 'Yes. Fintech targets are technology companies, so revenue, code, delivery, security and contract review run as they do for any software deal. The fintech pack adds regulatory, AML and loan-book findings on top.' },
      { q: 'What evidence does the fintech pack read?', a: 'Core-banking and payment records alongside the usual software sources. Findings cite the records they rest on, and a named reviewer decides each one.' },
      { q: 'How do regulatory and credit findings reach the price?', a: 'An accepted finding becomes a priced risk: a regulatory-capital or credit-quality adjustment in the scenario, or an escrow, indemnity or closing condition in the terms.' },
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
      { q: 'Does this involve patient data?', a: 'The pack works from reimbursement, contract and compliance evidence, in aggregate by default. Sensitive personal data is gated and never sent to a model.' },
      { q: 'Which risks does the healthcare pack check?', a: 'Reimbursement risk from payer mix and coding, Stark Law and anti-kickback exposure, and HIPAA privacy and security posture — each a finding with its evidence and a named reviewer.' },
      { q: 'Does it cover healthtech software targets?', a: 'Yes. A healthtech target runs the software diligence as well, so revenue, code and contract findings sit next to the reimbursement and compliance ones.' },
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
      { q: 'What does the telecom and media pack read?', a: 'Subscriber billing and plan data, set against the KPIs the seller reports. Reported and billed subscribers are reconciled before anything reaches the valuation.' },
      { q: 'How different is this from SaaS?', a: 'Less than it looks: ARPU is MRR per account, subscriber churn is logo churn, subscriber cohorts are revenue cohorts. The pack adds subscriber-billing sources and sector definitions.' },
      { q: 'How do churn and ARPU move the price?', a: 'They are scenario inputs. The engine runs them deterministically from stored inputs, so every price change traces back to the subscriber rows behind it.' },
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
      { q: 'What does the services pack measure?', a: 'Utilization, attrition, bench cost and client concentration, from timesheet and professional-services records and the client contracts.' },
      { q: 'How is people data handled?', a: 'In aggregate by default. Named and compensation data stay gated and audited, and are never sent to a model — the same rules as the rest of Pactlab.' },
      { q: 'How do the findings reach the deal?', a: 'As earnings-quality adjustments in the valuation, and as earn-outs, retention arrangements or price adjustments in the terms, each linked to its finding.' },
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
      { q: 'What evidence does the pack read?', a: 'Trial registries, regulatory filings, patent data and manufacturing records, alongside the documents in the data room. Every finding cites the filing or protocol it rests on.' },
      { q: 'How are approval and exclusivity risks priced?', a: 'Approval timing and exclusivity dates are scenario inputs. Accepted findings become milestones, contingent payments or indemnities tied to the risk behind them.' },
      { q: 'Who decides the scientific and regulatory findings?', a: 'Your reviewers. Models can draft findings with citations; only a named person can accept them.' },
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
    faq: [
      { q: 'What does the e-commerce pack read?', a: 'Storefront and marketplace orders, and ad-platform spend. Acquisition cost and lifetime value come from those records, not from a summary.' },
      { q: 'Does it change how the brand is valued?', a: 'No. The valuation methods are the same; unit-economics findings feed them as inputs and adjustments.' },
      { q: 'How is channel risk handled?', a: 'Channel and marketplace concentration uses the same concentration analysis as revenue, and an accepted finding becomes a channel-risk adjustment in the terms.' },
    ],
  },

  multifamily: {
    headline: 'Pay for the rent roll, not the offering memorandum.',
    subhead:
      'Multifamily value is net operating income over a cap rate. Pactlab rebuilds the income from the rent roll and the T-12, checks the condition of the units, and prices what it finds.',
    illustrationAlt: 'Illustration of an apartment building, a rent roll and a net operating income chart.',
    pains: [
      { icon: 'Receipt', title: 'Income that only exists in the memorandum', body: 'Pro-forma rents and in-place rents are different numbers, and the price is set on one of them.' },
      { icon: 'Building2', title: 'Deferred maintenance behind every door', body: 'Unit inspections tell a different story from the photographs.' },
      { icon: 'Percent', title: 'Delinquency in a few buildings', body: 'A blended collection rate can hide where the arrears really sit.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'The rent roll, T-12, lease files, delinquency reports, utility bills and unit inspections are connected for the deal and kept with their source.' },
      { step: 'Finding', text: 'Loss-to-lease, deferred maintenance per door and delinquency concentration are drafted with the rows and inspections behind them.' },
      { step: 'Review', text: 'A reviewer accepts the maintenance finding with its cost range and asks for support on the delinquency trend.' },
      { step: 'Valuation', text: 'Net operating income and the cap rate run in the scenario engine; capex per door lands as remediation.' },
      { step: 'Deal terms', text: 'Deferred maintenance becomes a price adjustment or a repair escrow. Loss-to-lease upside is recorded as confirmed value, never added to the price.' },
    ],
    findings: [
      { title: 'Deferred maintenance above the capex budget', severity: 'High', evidence: 'Unit-condition inspections against the capital plan', term: 'Repair escrow or price adjustment' },
      { title: 'Delinquency concentrated in one building', severity: 'Medium', evidence: 'Delinquency reports reconciled to the rent roll', term: 'Collections covenant and downside case' },
      { title: 'In-place rents below market across the property', severity: 'Medium', evidence: 'Rent roll against current lease files', term: 'Confirmed value in the ledger, not price paid' },
    ],
    deliverables: [
      { icon: 'ArrowLeftRight', title: 'An income bridge', body: 'From the memorandum to the rent roll, with the difference signed off.' },
      { icon: 'ClipboardList', title: 'A capex register per door', body: 'Every accepted maintenance finding with its evidence and cost range.' },
      { icon: 'Calculator', title: 'NOI and cap-rate scenarios', body: 'Run from stored inputs, so every change in price can be traced.' },
    ],
    faq: [
      { q: 'What does the multifamily pack read?', a: 'The rent roll and T-12, lease files, delinquency reports, utility bills and unit-condition inspections. The rent roll maps onto the same revenue ledger Pactlab uses for recurring revenue.' },
      { q: 'Does loss-to-lease raise the price we pay?', a: 'No. Upside from below-market rents is recorded as confirmed value — evidence that supports the price — and never as a reason to pay more.' },
      { q: 'How is capex handled?', a: 'Deferred maintenance per door is a priced finding. Once a reviewer accepts it, it becomes remediation in the valuation and a price adjustment or escrow in the terms.' },
    ],
  },

  'commercial-property': {
    headline: 'A building is worth the leases inside it.',
    subhead:
      'Office, retail and industrial assets are priced on lease income and how long it lasts. Pactlab abstracts the leases with exact citations, maps the rollover, and flags what the environmental and zoning record holds.',
    illustrationAlt: 'Illustration of a commercial building, a lease rollover timeline and an environmental report.',
    pains: [
      { icon: 'ChartPie', title: 'Two tenants, most of the income', body: 'Tenant concentration decides how durable the income is.' },
      { icon: 'Hourglass', title: 'Leases that end inside the hold period', body: 'A strong WALT on paper can hide a wall of near-term expiries.' },
      { icon: 'ShieldAlert', title: 'An environmental report nobody read closely', body: 'Phase I findings and zoning limits travel with the asset.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Lease abstracts, the rent roll, CAM reconciliations, Phase I environmental assessments and zoning documents.' },
      { step: 'Finding', text: 'Tenant concentration, near-term rollover against WALT, above- and below-market leases and environmental flags, each citing its clause or report.' },
      { step: 'Review', text: 'Reviewers decide each finding with the lease clause or report page in view.' },
      { step: 'Valuation', text: 'WALT and the rollover schedule are scenario inputs, with cap-rate sensitivity run deterministically.' },
      { step: 'Deal terms', text: 'Price adjustments, leasing reserves and environmental indemnities tied to the findings.' },
    ],
    findings: [
      { title: 'Anchor tenant lease expires within the hold period', severity: 'High', evidence: 'Expiry and renewal clauses cited from the lease', term: 'Leasing reserve and downside case' },
      { title: 'Recognized environmental condition in the Phase I', severity: 'High', evidence: 'Phase I environmental site assessment, cited by page', term: 'Environmental indemnity or escrow' },
      { title: 'CAM recoveries below expenses', severity: 'Medium', evidence: 'CAM reconciliations against the operating statement', term: 'Income adjustment in the valuation' },
    ],
    deliverables: [
      { icon: 'FileText', title: 'Cited lease abstracts', body: 'Every key term tied to the clause it came from.' },
      { icon: 'CalendarRange', title: 'A rollover schedule', body: 'Expiries against WALT, in the valuation rather than an appendix.' },
      { icon: 'SlidersHorizontal', title: 'Cap-rate sensitivity', body: 'What a change in cap rate does to price, from stored inputs.' },
    ],
    faq: [
      { q: 'Which property types does the pack cover?', a: 'Office, retail and industrial assets, single buildings and portfolios.' },
      { q: 'How are leases abstracted?', a: 'Models draft the abstract with exact citations to the lease; a clause that cannot be found is rejected, and a named reviewer accepts each term.' },
      { q: 'How do environmental findings reach the deal?', a: 'An accepted Phase I or zoning finding becomes a priced risk — an indemnity, an escrow or a price adjustment — linked to the page it came from.' },
    ],
  },

  hotels: {
    headline: 'A hotel is an operating business on a property.',
    subhead:
      'Room revenue, brand obligations and the capex the brand will demand decide what a hotel is worth. Pactlab reads the operating history and the agreements, and prices the property-improvement plan before you sign.',
    illustrationAlt: 'Illustration of a hotel building, a RevPAR chart and a brand agreement.',
    pains: [
      { icon: 'ChartLine', title: 'RevPAR read without the competitive set', body: 'Growth that trails the market is decline in disguise.' },
      { icon: 'Stamp', title: 'A brand renovation plan waiting at closing', body: 'Property-improvement plans can land on the buyer the day the deal closes.' },
      { icon: 'Snowflake', title: 'Demand that lives in one season', body: 'A strong year can rest on a few months or a single demand source.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'PMS and STR reports, franchise and brand agreements, management contracts, occupancy, ADR and RevPAR history, and food-and-beverage P&Ls.' },
      { step: 'Finding', text: 'Deferred PIP capex, franchise encumbrances and termination windows, and demand seasonality, each citing its source.' },
      { step: 'Review', text: 'Reviewers decide each finding with the agreement clause or operating rows in view.' },
      { step: 'Valuation', text: 'RevPAR and GOP-margin trends feed the scenarios; PIP capex lands as remediation.' },
      { step: 'Deal terms', text: 'PIP capex as a price adjustment or escrow, and brand consents as closing conditions.' },
    ],
    findings: [
      { title: 'Brand PIP required on change of ownership', severity: 'High', evidence: 'Clause cited from the franchise agreement', term: 'Price adjustment or PIP escrow' },
      { title: 'RevPAR growth trailing the competitive set', severity: 'Medium', evidence: 'STR reports against the operating history', term: 'Downside case in the valuation' },
      { title: 'Management contract terminable only with a fee', severity: 'Medium', evidence: 'Termination clause cited from the management contract', term: 'Termination cost in the purchase-price bridge' },
    ],
    deliverables: [
      { icon: 'ChartLine', title: 'RevPAR and margin trends', body: 'From the operating history, set against the competitive set.' },
      { icon: 'Stamp', title: 'A brand obligations register', body: 'PIP, encumbrances and termination windows, each with its clause.' },
      { icon: 'Handshake', title: 'Terms that carry the capex', body: 'PIP costs priced into the deal rather than discovered after it.' },
    ],
    faq: [
      { q: 'What does the hotels pack read?', a: 'PMS and STR reports, franchise and brand agreements, management contracts, occupancy, ADR and RevPAR history, and food-and-beverage P&Ls.' },
      { q: 'How is the property-improvement plan priced?', a: 'As a priced finding. Once accepted, PIP capex is remediation in the valuation and a price adjustment or escrow in the terms.' },
      { q: 'Does it cover independent hotels?', a: 'Yes. Without a brand there are no franchise findings; operating, demand and management-contract findings still apply.' },
    ],
  },

  'small-clinics': {
    headline: 'In a clinic roll-up, revenue follows the providers.',
    subhead:
      'Provider concentration, billing practice and equipment age decide what a clinic is worth. The small-clinics pack builds on the healthcare pack and reads the provider, billing and equipment records behind each site.',
    illustrationAlt: 'Illustration of a small clinic, a provider schedule in aggregate and a billing report.',
    pains: [
      { icon: 'UserRound', title: 'One provider carrying the site', body: 'Patient volume often depends on a few providers, and they can leave.' },
      { icon: 'ShieldPlus', title: 'Coding that will not survive an audit', body: 'Billing patterns that look efficient can be compliance exposure.' },
      { icon: 'Timer', title: 'Equipment at the end of its life', body: 'Replacement capex is easy to leave out of the forecast.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Provider contracts, patient volume, billing and RCM reports, equipment schedules and HIPAA and Stark Law compliance records.' },
      { step: 'Finding', text: 'Provider concentration, coding and billing risk, and aged equipment, drafted with the records behind them — provider data in aggregate.' },
      { step: 'Review', text: 'Clinical, compliance and financial reviewers decide in one workflow.' },
      { step: 'Valuation', text: 'Revenue per provider and post-close retention risk feed the scenarios; equipment replacement lands as remediation.' },
      { step: 'Deal terms', text: 'Retention arrangements, compliance indemnities and equipment escrows tied to the findings.' },
    ],
    findings: [
      { title: 'Most site revenue from one provider', severity: 'High', evidence: 'Patient volume and billing, aggregated by provider', term: 'Retention arrangement and earn-out' },
      { title: 'Coding pattern outside documented practice', severity: 'High', evidence: 'Billing and RCM reports against coding policy', term: 'Compliance indemnity and remediation covenant' },
      { title: 'Imaging equipment past its service life', severity: 'Medium', evidence: 'Equipment schedule and service records', term: 'Equipment escrow or price adjustment' },
    ],
    deliverables: [
      { icon: 'Users', title: 'Provider concentration, in aggregate', body: 'Which sites depend on whom, with named data gated.' },
      { icon: 'ShieldPlus', title: 'A billing and compliance register', body: 'Coding, HIPAA and Stark Law findings with their evidence.' },
      { icon: 'Calculator', title: 'Revenue per provider', body: 'Scenarios that show what retention does to price.' },
    ],
    faq: [
      { q: 'How does this relate to the healthcare pack?', a: 'It extends it. The reimbursement and compliance findings of the healthcare pack apply; the small-clinics pack adds provider, billing and equipment evidence.' },
      { q: 'How is provider data handled?', a: 'In aggregate by default. Named data is gated and audited, and provider, performance and compensation data are never sent to a model.' },
      { q: 'Which clinics does it cover?', a: 'Physician, dental, veterinary and therapy clinics, one site or many.' },
    ],
  },

  hospitals: {
    headline: 'Hospital earnings are only as good as the payer mix.',
    subhead:
      'Payer concentration, licensure and the physicians who carry service lines decide what a hospital is worth. The hospitals pack builds on the healthcare pack and reads the cost reports, census and accreditation record.',
    illustrationAlt: 'Illustration of a hospital building, a payer-mix chart and an accreditation certificate.',
    pains: [
      { icon: 'ChartPie', title: 'One payer behind most of the earnings', body: 'A rate change at a single payer reprices the hospital.' },
      { icon: 'BadgeCheck', title: 'Licensure that may not transfer cleanly', body: 'Licences and accreditation have conditions that a change of ownership can trigger.' },
      { icon: 'UserRound', title: 'Service lines built on a few physicians', body: 'Key-physician dependence is revenue risk at closing.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Payer mix, census and average daily census, Medicare cost reports, licensure and accreditation records, and malpractice history.' },
      { step: 'Finding', text: 'Payer concentration, licensure and accreditation gaps, and key-physician dependence, each citing its record — physician data in aggregate.' },
      { step: 'Review', text: 'Clinical, regulatory and financial reviewers decide in one workflow.' },
      { step: 'Valuation', text: 'Payer-mix-adjusted EBITDA and regulatory capex run in the same scenario engine.' },
      { step: 'Deal terms', text: 'Regulatory approvals as closing conditions, indemnities and capex escrows tied to the findings.' },
    ],
    findings: [
      { title: 'Earnings concentrated in one payer', severity: 'High', evidence: 'Payer mix from the cost reports and remittance data', term: 'Payer-mix-adjusted EBITDA in the valuation' },
      { title: 'Accreditation condition triggered by change of ownership', severity: 'High', evidence: 'Accreditation record, cited', term: 'Regulatory approval as a closing condition' },
      { title: 'Cardiology line depends on two physicians', severity: 'Medium', evidence: 'Census by service line, aggregated', term: 'Retention arrangement in the integration plan' },
    ],
    deliverables: [
      { icon: 'ChartPie', title: 'A payer-mix picture', body: 'Concentration and rate exposure from the cost reports.' },
      { icon: 'BadgeCheck', title: 'A licensure and accreditation register', body: 'Gaps and conditions, each with its record.' },
      { icon: 'Coins', title: 'Payer-mix-adjusted EBITDA', body: 'Earnings adjusted with the basis stated, and regulatory capex as remediation.' },
    ],
    faq: [
      { q: 'How does this relate to the healthcare pack?', a: 'It extends it. Reimbursement and regulatory findings from the healthcare pack apply; the hospitals pack adds census, cost-report, licensure and accreditation evidence.' },
      { q: 'Does this involve patient data?', a: 'The pack works from payer, census, cost-report and licensure evidence, in aggregate. Sensitive personal data is gated and never sent to a model.' },
      { q: 'How is regulatory capex handled?', a: 'As a priced finding. Once accepted, it is remediation in the valuation and an escrow or price adjustment in the terms.' },
    ],
  },
};

/**
 * Industries the site shows: those with a story (and so a page). A pack can
 * be defined in `INDUSTRIES` before its page is written (ADR 0008); it stays
 * off the index, navigation and cross-links until then.
 */
export const PUBLISHED_INDUSTRIES = INDUSTRIES.filter((industry) => industry.slug in INDUSTRY_STORIES);
