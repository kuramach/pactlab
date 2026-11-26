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
    headline: 'Test the volume and the licences before you pay for them.',
    subhead:
      'Fintech deals are priced on volume and growth claims that live in processor exports, and on licences that can lapse quietly. Pactlab recomputes the volume, take rate and loss rates from the exports, checks the deck against them, reads every licence’s status and expiry, and runs the software baseline as it is.',
    illustrationAlt: 'Illustration of a payment card, a bank building and a shield, connected by a transaction flow.',
    pains: [
      { icon: 'ChartLine', title: 'A volume claim the exports do not support', body: 'The deck’s TPV counts a processor month twice, and the price is set on it.' },
      { icon: 'Landmark', title: 'A licence that lapsed quietly', body: 'One state licence expired months ago, and the register still says active.' },
      { icon: 'ShieldAlert', title: 'Loss rates near a covenant', body: 'Chargebacks climb past the threshold the sponsor bank wrote into the agreement.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Processor exports, the licence register, the loan tape, AML alerts and the P&L by year arrive as imports; the deck, licences, the sponsor agreement and compliance documents are read with their source.' },
      { step: 'Finding', text: 'Deterministic checks draft contradicted claims, lapsed or expiring licences, loss-threshold breaches, unreconciled revenue, costs outpacing revenue and missing compliance evidence, each cited.' },
      { step: 'Review', text: 'A named reviewer accepts, rejects or asks for support on every finding; nothing is decided by the software.' },
      { step: 'Valuation', text: 'ARR-multiple and DCF scenarios as for any software deal, with accepted findings on the purchase-price bridge.' },
      { step: 'Deal terms', text: 'A lapsed licence priced as an escrow or indemnity, or reinstatement as a closing condition; a breach priced as a holdback, each traced to its source.' },
    ],
    findings: [
      { title: 'Deck TPV double-counts one processor month', severity: 'High', evidence: 'The deck’s figure against the processor exports', term: 'A haircut on the volume the price assumes' },
      { title: 'State money-transmitter licence lapsed four months ago', severity: 'High', evidence: 'The licence’s stated expiry against the register', term: 'Reinstatement as a closing condition, or an escrow' },
      { title: 'Chargeback rate over the sponsor agreement’s threshold', severity: 'High', evidence: 'Quarterly rates from the exports against the clause', term: 'A reserve holdback' },
    ],
    deliverables: [
      { icon: 'ChartLine', title: 'Volume and take rate you can trace', body: 'TPV, transactions and take rate recomputed from the exports, with the rows behind each figure.' },
      { icon: 'Landmark', title: 'A licence register, checked', body: 'Every licence and sponsor agreement with its status and expiry, from the register and the documents.' },
      { icon: 'TrendingUp', title: 'The P&L across every year', body: 'Revenue, margins and fraud, credit and processing costs against revenue, year by year.' },
    ],
    faq: [
      { q: 'Does the software diligence still run on a fintech target?', a: 'Yes. Fintech targets are technology companies, so revenue, code, delivery, security and contract review run as they do for any software deal. The fintech pack adds the payments, licence, loss-rate and compliance checks on top.' },
      { q: 'What evidence does the fintech pack read?', a: 'Processor or bank settlement exports, the licence and sponsor register, the loan tape, AML alerts and the P&L by year, plus the deck, the licences, the sponsor agreement and compliance documents. Every finding cites the rows or the page it rests on.' },
      { q: 'Does it tell me whether a licence is required, or whether a programme is compliant?', a: 'No. It reports licence status and dates as the register and the documents state them, and compliance evidence as present or absent. Whether a licence is needed, and what a lapse means, is for your counsel.' },
      { q: 'Where do the thresholds come from?', a: 'Only from the documents themselves, such as the sponsor agreement’s monitoring clause. With no stated threshold, rates are shown as computed and nothing is compared.' },
    ],
  },

  healthcare: {
    headline: 'Test the collections and the credentials before you buy the practice.',
    subhead:
      'Provider-services deals are priced on collections that depend on payer contracts, denial behaviour and clinicians staying credentialed. Pactlab recomputes collections, denials and the payer mix from the remittances, checks the deck against them, reads every clinician’s licence, and checks the documents, dates and arithmetic — never the quality of care.',
    illustrationAlt: 'Illustration of a clinic building, a heartbeat line and a claims checklist.',
    pains: [
      { icon: 'Stethoscope', title: 'A denial rate the deck says is falling', body: 'The remittances show denials rising three years running, and the write-offs with them.' },
      { icon: 'BadgeCheck', title: 'A licence that expired quietly', body: 'The register says active; the board says expired, and the clinician kept billing.' },
      { icon: 'UserRound', title: 'One clinician who is the business', body: 'A third of collections from one clinician, with no non-compete on file.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Remittances by payer, collections by clinician, the roster, the credentialing and payer contract registers and the P&L by year arrive as imports; the deck, licence verifications, the non-compete schedule, audits and agreements are read with their source.' },
      { step: 'Finding', text: 'Deterministic checks draft contradicted claims, rising denials, payer-mix drift, expired licences, clinician concentration, expiring payer contracts and costs outpacing revenue, each cited to the rows or the page.' },
      { step: 'Review', text: 'A named reviewer accepts, rejects or asks for support on every finding; nothing is decided by the software.' },
      { step: 'Valuation', text: 'DCF scenarios, with ARR multiple for healthtech, and accepted findings on the purchase-price bridge; payer mix and rates as scenario sensitivities.' },
      { step: 'Deal terms', text: 'An expired licence priced as an escrow or special indemnity, or reinstatement as a closing condition; a retention holdback for a clinician without a non-compete; each traced to its source.' },
    ],
    findings: [
      { title: 'Denial rate rising three years running; the deck says it fell', severity: 'High', evidence: 'Denied ÷ adjudicated claims from the remittances, against the deck', term: 'A haircut on the collections the price assumes' },
      { title: 'Two clinicians collecting after their licences expired', severity: 'High', evidence: 'The verification document’s expiry against the register and the collections export', term: 'Reinstatement as a closing condition, or an escrow' },
      { title: 'One clinician carries 31% of collections, no non-compete on file', severity: 'High', evidence: 'Collections by clinician against the non-compete schedule', term: 'A retention holdback or an earn-out' },
    ],
    deliverables: [
      { icon: 'Stethoscope', title: 'Collections you can trace', body: 'Collections, denials, days in receivable and the payer mix by year, with the rows behind each figure.' },
      { icon: 'BadgeCheck', title: 'A credentialing register, checked', body: 'Every clinician’s licence and expiry from the register and the verification documents.' },
      { icon: 'TrendingUp', title: 'The P&L across every year', body: 'Revenue, margins and denial write-offs, clinical staff, supplies and billing costs against revenue, year by year.' },
    ],
    faq: [
      { q: 'Does this involve patient data?', a: 'No. The pack reads payer-level remittances and clinician-level collections by pseudonymous reference — never a patient, a claim line or a diagnosis. Clinician data stays in deterministic code and is never sent to a model.' },
      { q: 'Does it judge quality of care, or whether billing or referrals are lawful?', a: 'No. It checks documents, dates and arithmetic: licence status and expiry as the register and the verification documents state them, and compliance evidence as present or absent. Clinical and legal judgment is for your clinicians and counsel.' },
      { q: 'What evidence does the healthcare pack read?', a: 'Remittance or billing exports by payer, collections by clinician, the roster, the credentialing and payer contract registers and the P&L by year, plus the deck, licence verifications, the non-compete and retention schedule, coding audits, the HIPAA risk assessment and agreements. Every finding cites the rows or the page it rests on.' },
      { q: 'Does it cover healthtech software targets?', a: 'Yes. A healthtech target runs the software diligence as well, so revenue, code and contract findings sit next to the provider ones.' },
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

  'venture-raise': {
    headline: 'Walk into diligence knowing what the investor will find.',
    subhead:
      'Investors check the deck against billing, the cap table against the corporate record and the IP against the agreements. Venture Raise runs the same checks for the founder first, models every competing offer, and keeps what you find on your side until you choose to share it.',
    illustrationAlt: 'Illustration of a pitch deck metric checked against billing, a cap table and two term sheets side by side.',
    pains: [
      { icon: 'ChartLine', title: 'A deck number billing does not support', body: 'A headline metric the investor’s first check contradicts costs more credibility than any other finding.' },
      { icon: 'Layers', title: 'SAFEs that convert into more than you think', body: 'Caps, discounts and a forgotten MFN clause decide how much of the company the round really takes.' },
      { icon: 'FileLock', title: 'IP a contractor still owns', body: 'One agreement without an assignment becomes a closing condition.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Billing, the cap table, monthly cash and burn, the corporate record, contractor agreements, the SAFE register and the term sheets you have received.' },
      { step: 'Finding', text: 'The deck’s ARR is checked against billing and its runway against cash; SAFEs, the pool and the IP chain are checked against the documents. Every number in the deck becomes a claim: verified, contradicted or unverified.' },
      { step: 'Review', text: 'You decide what each finding means and fix what you can before an investor sees it. Strengths stay confidential until you choose to show them.' },
      { step: 'Valuation', text: 'Each offer runs through the round model: price per share, SAFE conversion at cap or discount, the pool shuffle in shares and percent, and the founders’ ownership after the round.' },
      { step: 'Deal terms', text: 'Liquidation preference and board composition are explained in plain language. Pactlab shows what a term does; the decision stays with you and your counsel.' },
    ],
    findings: [
      { title: 'Deck ARR above billed ARR', severity: 'High', evidence: 'Invoice lines against the deck’s headline metric', term: 'Correct the deck before the investor’s check' },
      { title: 'MFN SAFE takes a later, lower cap', severity: 'High', evidence: 'Cap table and the SAFE register', term: 'More conversion shares in every scenario' },
      { title: 'Contractor agreement without IP assignment', severity: 'High', evidence: 'The agreement in the data room', term: 'Confirmatory assignment before closing' },
    ],
    deliverables: [
      { icon: 'ListChecks', title: 'A claims register', body: 'Every deck number with its evidence and status.' },
      { icon: 'Handshake', title: 'Offers side by side', body: 'Each investor’s terms and what the founders own after each.' },
      { icon: 'EyeOff', title: 'An investor view', body: 'Verified numbers and the data room, with nothing confidential in it.' },
    ],
    faq: [
      { q: 'Who is this for?', a: 'Founders raising pre-seed, seed or Series A money from angels, incubators and accelerators, or venture funds — the founder is the Pactlab user.' },
      { q: 'Can I compare several investors?', a: 'Yes. Each investor’s bid is an offer in the same raise; the round model runs for every one and shows them side by side, without ranking them.' },
      { q: 'Does it give legal or financial advice?', a: 'No. It shows the mechanics and consequences of each term and the evidence behind each finding. Decisions stay with you and your advisers.' },
    ],
  },
  'multifamily-syndication': {
    headline: 'Test the offering against the property and the agreement.',
    subhead:
      'A syndication is two deals at once: the property the sponsor buys and the offering investors buy into. Pactlab diligences the property with the Multifamily pack, reads the PPM and operating agreement, recomputes the waterfall and checks every claim against its evidence.',
    illustrationAlt: 'Illustration of an apartment community, an offering memorandum and a distribution waterfall.',
    pains: [
      { icon: 'ChartLine', title: 'A projected IRR the waterfall cannot reach', body: 'The deck states a return; the operating agreement’s own terms, on the property’s own income, produce another.' },
      { icon: 'Receipt', title: 'Fees that only the agreement mentions', body: 'A fee in the operating agreement that the PPM summary leaves out changes what investors keep.' },
      { icon: 'History', title: 'Track-record claims with nothing behind them', body: 'A prior deal described in the deck with no actual returns on file is a claim, not a record.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'The rent roll, T-12 and inspections run through the Multifamily pack; the PPM, operating agreement, deck and the sponsor’s prior-deal records are read with their source.' },
      { step: 'Finding', text: 'Fees, the preferred return and promote tiers are proposed from the documents with exact quotes. The waterfall is recomputed from the confirmed terms, and every mismatch is drafted as a finding.' },
      { step: 'Review', text: 'The sponsor confirms or corrects each extracted term; a reviewer accepts the findings and settles each claim as verified, contradicted or unverified.' },
      { step: 'Valuation', text: 'The property is priced on NOI and cap rate. Investor returns after pref and promote run on downside, base and upside paths, labelled as scenarios from stated assumptions.' },
      { step: 'Deal terms', text: 'Offering defects are corrected in the documents before investors see them; property findings carry into the price and terms with the seller, behind the wall.' },
    ],
    findings: [
      { title: 'Projected IRR above the recomputed waterfall', severity: 'High', evidence: 'Operating agreement terms on the T-12 income path', term: 'Correct the PPM and deck before the raise' },
      { title: 'Operating-agreement fee missing from the PPM', severity: 'High', evidence: 'The agreement’s fee clause against the PPM fee summary', term: 'Disclose the fee in the PPM' },
      { title: 'Prior-deal claim with no actuals', severity: 'Medium', evidence: 'The deck’s track-record statement against the prior-deal records', term: 'Unverified claim until actuals are supplied' },
    ],
    deliverables: [
      { icon: 'ListChecks', title: 'An offering claims register', body: 'Every material claim with its evidence and status.' },
      { icon: 'Calculator', title: 'A waterfall check', body: 'Stated against recomputed returns, with the conventions written out.' },
      { icon: 'ClipboardList', title: 'A track-record table', body: 'Prior deals, projected against actual, with absence shown as absence.' },
    ],
    faq: [
      { q: 'How is this different from the Multifamily pack?', a: 'The Multifamily pack is a two-party sale. A syndication adds the raise: the sponsor diligences the property, and the offering is diligenced against the property, the operating agreement and the sponsor’s record. The property checks are the Multifamily pack’s, unchanged.' },
      { q: 'Does Pactlab verify accreditation?', a: 'No. Pactlab makes no accreditation determination. It tracks each investor’s status and the evidence pointer from the specialist who verified it.' },
      { q: 'Is this legal advice or a securities offering service?', a: 'No. It is diligence support: it organises evidence and flags gaps for the parties and their counsel. It performs no securities-offering or broker-dealer function.' },
      { q: 'Can the seller see the raise?', a: 'No. The offering is the sponsor’s own side of the pact. The seller never sees the raise, and investors never see the acquisition negotiation.' },
    ],
  },
  'music-rights': {
    headline: 'Buy the royalties you can prove.',
    subhead:
      'A music catalog is bought for its royalty income, and the diligence fails in checkable ways: a hit with no assignment, splits that add up to 105%, grants authors can terminate during your hold. Pactlab builds the register from statements and registrations, models the income and quantifies the termination exposure.',
    illustrationAlt: 'Illustration of a music catalog: records, a royalty statement and a rights register.',
    pains: [
      { icon: 'FileLock', title: 'Income with no title behind it', body: 'A work earns on every statement, but nothing in the chain of title shows how the seller came to own it.' },
      { icon: 'Hourglass', title: 'Rights that can go home', body: 'Grants made decades ago become terminable under US copyright law, sometimes in the middle of the hold.' },
      { icon: 'Receipt', title: 'Income that is already spent', body: 'An unrecouped advance on the administrator’s ledger takes the royalties before they reach the owner.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'The works register, writer splits, chain of title and royalty statements arrive as imports; statements, split sheets, agreements and lien searches are read with their source.' },
      { step: 'Finding', text: 'Deterministic checks draft title gaps, split mismatches, termination exposure, concentration, unrecouped advances, undisclosed liens and missing statement periods, each cited.' },
      { step: 'Review', text: 'Entries read from documents are confirmed or corrected by a person before they count; a reviewer accepts or rejects every finding.' },
      { step: 'Valuation', text: 'A royalty multiple on the trailing, decay-adjusted net income, with the termination exposure as its own line on the bridge.' },
      { step: 'Deal terms', text: 'Title gaps become a holdback, the exposed income a price reduction, and an undisclosed lien an indemnity, each traced to its source.' },
    ],
    findings: [
      { title: 'Hit work with no assignment on record', severity: 'High', evidence: 'The chain of title against the work’s statement income', term: 'Title holdback until the assignment is produced' },
      { title: 'Termination windows inside the hold', severity: 'High', evidence: 'Grant dates against §203 and §304 windows, on trailing income', term: 'Price reduction on the exposed share' },
      { title: 'Unrecouped advance left out of the summary', severity: 'High', evidence: 'The administrator’s ledger against the seller’s summary', term: 'Comes off the price' },
    ],
    deliverables: [
      { icon: 'ClipboardList', title: 'A works and rights register', body: 'Every work with its income, splits, title evidence and termination window.' },
      { icon: 'ChartLine', title: 'An income model', body: 'Trailing income by source and catalog age, with the decay adjustment written out.' },
      { icon: 'Hourglass', title: 'A termination exposure schedule', body: 'Which grants open inside the hold, and how much income stands behind them.' },
    ],
    faq: [
      { q: 'Does Pactlab tell me whether title is good?', a: 'No. It is diligence support, not legal advice: it organises the evidence and flags gaps in the chain of title for you and your counsel. It makes no determination that title is good.' },
      { q: 'Does it decide whether a termination notice is valid?', a: 'No. It computes the §203 and §304 windows from the grant dates, states its conventions and quantifies the income behind them. Whether a notice has been or could be validly served is for counsel.' },
      { q: 'Where do the income figures come from?', a: 'Only from royalty statements, registries and connected sources. A missing statement period is shown as a gap, never estimated.' },
      { q: 'Does growth raise the price?', a: 'No. The multiple applies to decay-adjusted income: declines reduce it and growth is never added. Verified growth and clean title are recorded as confirmed value.' },
    ],
  },
  'energy-generation': {
    headline: 'Price the liabilities before you inherit them.',
    subhead:
      'Plants and oil & gas interests trade on title chains, production and reserve data, contracts — and large, quantifiable obligations. Pactlab builds the asset and interest register, checks production against the reserve report and sets every remediation and retirement estimate against what the seller booked.',
    illustrationAlt: 'Illustration of a power plant, a well site and a liability schedule.',
    pains: [
      { icon: 'ShieldAlert', title: 'Obligations left off the schedule', body: 'An ash-pond closure plan sits in the data room, and the liability schedule books nothing for it.' },
      { icon: 'Hourglass', title: 'Acreage on a clock', body: 'Leases not held by production expire during the hold, and the value goes with them.' },
      { icon: 'Percent', title: 'Decimals that do not add up', body: 'A division order pays a decimal the lease royalty chain does not support, and the operator can claw it back.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Plant and interest registers, leases, production and the liability schedule arrive as imports; reserve reports, title opinions, permits and studies are read with their source.' },
      { step: 'Finding', text: 'Deterministic checks draft unbooked liabilities, ARO shortfalls, decline mismatches, lease expiry, decimal errors, PPA cliffs, title breaks and compliance capex gaps, each cited.' },
      { step: 'Review', text: 'Entries read from reports are confirmed or corrected by a person before they count; a reviewer accepts or rejects every finding.' },
      { step: 'Valuation', text: 'A reserve-based DCF for the interests and $/kW plus contract coverage for the plants, through the standard bridge.' },
      { step: 'Deal terms', text: 'Unbooked remediation becomes a price reduction, the ARO shortfall an escrow and a title break a cure period or holdback, each traced to its source.' },
    ],
    findings: [
      { title: 'Ash-pond closure missing from the liability schedule', severity: 'High', evidence: 'The closure plan’s estimate against the seller’s schedule', term: 'Remediation cost off the price' },
      { title: 'Retirement obligation 40% under-booked', severity: 'High', evidence: 'The decommissioning study against the booked ARO', term: 'Escrow sized at the shortfall' },
      { title: 'A quarter of the acreage expiring inside the hold', severity: 'High', evidence: 'The lease schedule’s terms and production status', term: 'A drag on the exposed share' },
    ],
    deliverables: [
      { icon: 'ClipboardList', title: 'An asset and interest register', body: 'Every plant and interest with its contract, lease, decimal and production.' },
      { icon: 'ChartLine', title: 'A production and reserves view', body: 'Actual decline against the report’s assumption; reserves as the engineers state them.' },
      { icon: 'ShieldAlert', title: 'A liability schedule, checked', body: 'Every remediation and retirement estimate against what the seller booked, with the gap.' },
    ],
    faq: [
      { q: 'Does Pactlab estimate reserves?', a: 'No. Reserve figures come only from the third-party engineering report, cited as such and confirmed by a person. A missing report is shown as a gap, never filled in.' },
      { q: 'Does it tell me whether title is good?', a: 'No. It is diligence support, not legal, engineering or regulatory advice: it organises the evidence and flags breaks in the chain of title for you and your counsel. It makes no title determination.' },
      { q: 'Where do the liability figures come from?', a: 'Only from reports, permits and the seller’s schedule. Pactlab compares the evidence’s estimate with what was booked; it never estimates a liability itself.' },
      { q: 'Does clean title or an over-booked ARO raise the price?', a: 'No. Verified cushions are recorded as confirmed value, never as a price increase.' },
    ],
  },
  'startup-spv': {
    headline: 'Pool the money on a round that adds up.',
    subhead:
      'An SPV organizer answers to every investor for two things: the startup’s round and the vehicle’s own terms. Pactlab recomputes the cap table with every SAFE converted, checks each deck claim against its evidence, recomputes fee and carry from the operating agreement, and publishes to investors only what you choose to share.',
    illustrationAlt: 'Illustration of a pooled vehicle: several investors joining into one line on a startup’s cap table.',
    pains: [
      { icon: 'Calculator', title: 'A cap table that does not add up', body: 'The round summary forgets that the SAFEs convert, so the vehicle owns less than everyone was told.' },
      { icon: 'Percent', title: 'Terms that changed on the way', body: 'The operating agreement says 20% carry; the summary investors signed up on says 15%.' },
      { icon: 'FileLock', title: 'Side deals and eligibility', body: 'A side letter waives one investor’s fee, and one investor in a 506(c) vehicle was never verified.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'The startup’s billing, cap table and cash come in as imports; the round summary, SAFEs, operating agreement, investor summary, side letters and Form D are read with their source.' },
      { step: 'Finding', text: 'Deterministic checks draft cap-table and round-math gaps, contradicted or unsupported claims, fee and carry mismatches, undisclosed side letters, accreditation gaps and a missing Form D, each cited.' },
      { step: 'Review', text: 'A reviewer accepts or rejects every finding; the claims register shows each deck claim as verified, contradicted or unverified.' },
      { step: 'Valuation', text: 'The round’s pre-money recomputed from the price and the share count, and net-of-fees return scenarios on the exit paths you state.' },
      { step: 'Deal terms', text: 'What you publish to investors is a frozen, versioned snapshot: the claims register, the round check, the vehicle economics and the scenarios — nothing else.' },
    ],
    findings: [
      { title: 'Post-round shares miss the SAFE conversion', severity: 'High', evidence: 'The cap table with every SAFE converted against the round summary', term: 'Correct the summary before the vehicle commits' },
      { title: 'Carry differs from the investor summary', severity: 'High', evidence: 'The operating agreement against the summary of terms', term: 'Correct and re-disclose to investors' },
      { title: 'Undisclosed fee waiver in a side letter', severity: 'High', evidence: 'The side letter against the summary’s disclosure', term: 'Disclose to every investor, or withdraw it' },
    ],
    deliverables: [
      { icon: 'Calculator', title: 'A round verification', body: 'Every conversion, the pre-money and the post-round count recomputed, with pro-rata rights per instrument.' },
      { icon: 'Percent', title: 'A vehicle economics check', body: 'Fee load and carry from the operating agreement, set against what investors were told.' },
      { icon: 'EyeOff', title: 'A published investor view', body: 'Versioned and frozen; one investor’s terms never appear in another’s view.' },
    ],
    faq: [
      { q: 'Does Pactlab verify accreditation?', a: 'No. Accreditation is tracked, not determined: you record what a verification specialist found, with a link and an evidence pointer, and the checks flag gaps for you and your counsel.' },
      { q: 'Is this legal or securities advice?', a: 'No. It is diligence support only: Pactlab performs no securities-offering, broker-dealer or investment-adviser function. It organises the evidence and flags gaps for the parties and their counsel.' },
      { q: 'Can investors see each other or the side letters?', a: 'No. Each investor sees their own seat and the investor view you publish; side letters, other investors and your own analysis never enter it. The startup never sees the investor list.' },
      { q: 'Are the return scenarios a forecast?', a: 'No. They are computed from exit paths you state, net of the vehicle’s fees and carry, and labelled as scenarios — never a projection or a promise.' },
    ],
  },
  'small-clinics': {
    headline: 'In a small clinic, the risk sits with one owner, one referrer and one lease.',
    subhead:
      'Small clinics trade on the same evidence as larger provider groups, but the risks concentrate. Pactlab reads the collections, credentials and payer contracts as the healthcare pack does, then recomputes how much the selling owner delivers, where the patients come from and how long the premises are secured — documents, dates and arithmetic, never clinical or legal judgment.',
    illustrationAlt: 'Illustration of a small clinic, a provider schedule in aggregate and a billing report.',
    pains: [
      { icon: 'UserRound', title: 'The owner is the highest-margin service', body: 'The selling owner is the only provider of the most profitable line, and no associate covers it.' },
      { icon: 'Link2', title: 'One referrer sends most of the patients', body: 'More than half the visits come from one hospital or practice; if it stops referring, volume falls.' },
      { icon: 'KeyRound', title: 'A lease that ends soon after closing', body: 'The term runs out a year or so after closing, with no renewal option and the landlord’s consent needed to assign.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'Remittances, collections by clinician, the credentialing and payer contract registers, service lines by provider, visits by referral source, patient volume, the equipment schedule and the P&L by year arrive as imports; the memorandum, the lease, licence verifications and policies are read with their source.' },
      { step: 'Finding', text: 'Deterministic checks draft a service line only the owner delivers, an owner share with no succession on file, a dominant referral source, a short lease without renewal, consent to assign, costs outpacing revenue, coding above policy and aged equipment, each cited to the rows or the page.' },
      { step: 'Review', text: 'A named reviewer accepts, rejects or asks for support on every finding; nothing is decided by the software.' },
      { step: 'Valuation', text: 'DCF scenarios, with accepted findings on the purchase-price bridge: owner and referral dependence as haircuts the reviewer prices, relocation risk and equipment replacement as adjustments.' },
      { step: 'Deal terms', text: 'A transition agreement or an earn-out tied to the owner’s line, the landlord’s consent or a new lease as a closing condition, each traced to its source.' },
    ],
    findings: [
      { title: '58% of visits come from one referral source', severity: 'High', evidence: 'Visits by referral source, recomputed from the schedule export', term: 'A haircut on the visits the price assumes' },
      { title: 'The lease ends 14 months after closing with no renewal option', severity: 'High', evidence: 'The lease’s end date and renewal sentence, against the stated closing date', term: 'Relocation or renegotiation risk priced, or a new lease as a closing condition' },
      { title: 'The selling owner is the only provider of the highest-margin service line', severity: 'High', evidence: 'Service lines by provider, with margins after direct costs', term: 'A transition agreement or an earn-out' },
    ],
    deliverables: [
      { icon: 'Users', title: 'The owner, in figures', body: 'The selling owner’s share of visits and collections, and the service lines only they deliver.' },
      { icon: 'KeyRound', title: 'The premises, read from the lease', body: 'Term left after closing, renewal and assignment, each with its quoted sentence.' },
      { icon: 'TrendingUp', title: 'The P&L across every year', body: 'Revenue, margins and supplies, laboratory, clinical staff and occupancy costs against revenue, year by year.' },
    ],
    faq: [
      { q: 'How does this relate to the healthcare pack?', a: 'It is the healthcare pack scaled to a few sites. The remittance, credentialing and payer contract checks run exactly as they do there; the small-clinics pack adds the owner-operator, referral and lease checks.' },
      { q: 'How is provider data handled?', a: 'Providers, including the selling owner, appear only as pseudonymous references such as P01. Their figures stay in deterministic code and are never sent to a model.' },
      { q: 'Does it judge whether a referral arrangement or a lease is lawful?', a: 'No. It reports shares, dates and the sentences the documents contain. Clinical and legal judgment is for your clinicians and counsel.' },
      { q: 'Which clinics does it cover?', a: 'Physician, dental, veterinary and therapy clinics of a few sites.' },
    ],
  },

  hospitals: {
    headline: 'A hospital is worth what its cost report, its payer contracts and its plant say.',
    subhead:
      'Hospitals carry evidence no other business does: filed cost reports, payer contracts that expire mid-hold, a medical staff whose privileges must be renewed, and a physical plant whose deferred capex hides in the P&L trend. Pactlab reconciles them against the deck and against each other — documents, dates and arithmetic, never a survey, clinical or legal judgment.',
    illustrationAlt: 'Illustration of a hospital building, a payer-mix chart and an accreditation certificate.',
    pains: [
      { icon: 'FileSearch', title: 'A deck the cost report does not support', body: 'The occupancy in the presentation is well above the occupancy the hospital filed.' },
      { icon: 'Handshake', title: 'The largest payer contract ends after closing', body: 'The biggest commercial payer can renegotiate its rates in the first year of the hold.' },
      { icon: 'Building2', title: 'A “modern plant” on falling capex', body: 'Capital spend has fallen every year, and the condition assessment lists what is past its service life.' },
    ],
    walkthrough: [
      { step: 'Evidence', text: 'The census, the payer mix, the medical-staff register and the P&L by year arrive as imports; the filed cost report, the management presentation, the payer agreements, the property condition assessment, the quality reporting and the accreditation record are read with their source.' },
      { step: 'Finding', text: 'Deterministic checks draft the deck’s figures contradicted by the cost report, cost-report costs that disagree with the P&L, payer contracts ending within a year of closing, departments whose privileges lapse together, capital spend falling across the years, quality claims against the reporting, payer concentration, accreditation that does not transfer and committed regulatory capex, each cited to the rows or the page.' },
      { step: 'Review', text: 'A named reviewer accepts, rejects or asks for support on every finding; nothing is decided by the software.' },
      { step: 'Valuation', text: 'Payer-mix-adjusted EBITDA, with a payer’s renegotiation tested as a rate change; committed regulatory capex and deferred maintenance land on the purchase-price bridge.' },
      { step: 'Deal terms', text: 'A renewed payer agreement, the department’s reappointments or the accreditation application as closing conditions, and capex holdbacks, each traced to its source.' },
    ],
    findings: [
      { title: 'The largest payer contract ends seven months after closing', severity: 'High', evidence: 'The payer agreement’s end date against the stated closing, and the payer’s share of the payer mix', term: 'A rate change in the scenarios, or a renewed agreement as a closing condition' },
      { title: 'The cost report’s occupancy contradicts the deck', severity: 'High', evidence: 'The filed cost report’s occupancy against the management presentation’s', term: 'Scenarios rebuilt on the filed figure' },
      { title: 'Capital spend fell three years running against a “modern plant” claim', severity: 'High', evidence: 'Capital spend ÷ revenue in every imported P&L year, with the property condition assessment', term: 'Deferred maintenance priced as remediation, or held back' },
      { title: 'One department’s clinical privileges lapsed together', severity: 'High', evidence: 'The medical-staff register’s reappointment dates, by department', term: 'Reappointment as a closing condition' },
    ],
    deliverables: [
      { icon: 'FileSearch', title: 'The cost report, reconciled', body: 'Occupancy and payer shares against the deck, and costs against the P&L, each with its quoted line.' },
      { icon: 'Handshake', title: 'A payer contract register', body: 'Each material payer’s rate basis, end date and renewal window, against the closing.' },
      { icon: 'TrendingUp', title: 'The plant across every year', body: 'Capital spend year by year beside the condition assessment, and the full P&L trend.' },
    ],
    faq: [
      { q: 'How does this relate to the healthcare pack?', a: 'It extends it. The healthcare pack’s medical-director fee and privacy assessment checks run here too; the hospitals pack adds the cost report, payer contracts, medical staff, plant and quality checks.' },
      { q: 'Does it predict a survey or judge the quality of care?', a: 'No. It compares stated figures, dates and ratings with the documents supplied. Survey, clinical and legal judgment is for your surveyors, clinicians and counsel.' },
      { q: 'How is staff and patient data handled?', a: 'No patient data is accepted. Medical staff appear only as pseudonymous references, their rows stay in deterministic code, and people data is never sent to a model.' },
      { q: 'How are capex and deferred maintenance handled?', a: 'As priced findings. Once accepted, committed regulatory capex and the deferred maintenance a condition assessment states are remediation on the purchase-price bridge.' },
    ],
  },
};

/** Industries with a story (and so a page). A pack can be defined in `INDUSTRIES` before its page is written (ADR 0008). */
export const WRITTEN_INDUSTRIES = INDUSTRIES.filter((industry) => industry.slug in INDUSTRY_STORIES);

/**
 * The packs on sale (Kumar, 2026-11-01): Software & SaaS and Multifamily, then
 * Venture Raise (2026-11-09), with the others released one at a time after testing (Fintech with its
 * payments and licence checks, T-159, 2026-11-26; Healthcare, T-160; Small clinics with its owner, referral and
 * lease checks, T-161, 2026-11-26; Hospitals with its cost-report, payer contract, medical-staff and plant
 * checks, T-162, 2026-11-26). Same list as the
 * app's RELEASED_COMPANY_TYPES (packages/domain/src/packs/release.ts).
 */
export const RELEASED_INDUSTRY_SLUGS: readonly string[] = ['software-saas', 'multifamily', 'venture-raise', 'music-rights', 'energy-generation', 'startup-spv', 'fintech', 'healthcare', 'small-clinics', 'hospitals'];

/** An environment's copy of the site (dev, qa) previews every written pack, for testing before release. */
export const PACK_PREVIEW = process.env['NEXT_PUBLIC_PACK_PREVIEW'] === 'true';

/** Industries the site shows: written, and released (or previewed). Index, navigation, footer, sitemap and llms.txt read this. */
export const PUBLISHED_INDUSTRIES = WRITTEN_INDUSTRIES.filter((industry) => PACK_PREVIEW || RELEASED_INDUSTRY_SLUGS.includes(industry.slug));

/** Whether a link may be shown: anything that is not an industry page, or a published industry's page. */
export function isPublishedHref(href: string): boolean {
  const match = /^\/industries\/([^/]+)/.exec(href);
  return !match || PUBLISHED_INDUSTRIES.some((industry) => industry.slug === match[1]);
}
