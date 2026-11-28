// Generated from the marketing site by apps/site/lib/support-corpus.ts. Do not edit:
// change the site content, then run `UPDATE_SUPPORT_CORPUS=1 pnpm --filter @pactlab/site test`.
import type { HelpArticle } from './corpus';

export const SITE_CORPUS: readonly HelpArticle[] = [
  {
    "id": "how-it-works:loop",
    "kind": "HOW_IT_WORKS",
    "title": "How Pactlab works: evidence in, defensible terms out",
    "url": "https://pactlab.ai/how-it-works/",
    "text": "Pactlab connects the deal’s sources, drafts the findings, and leaves every decision to a named person — keeping the chain of evidence intact from first record to final term.\nReads the systems the deal depends on. Each source connects through an adapter with the same contract, and every record keeps its link to where it came from.\nBilling: Invoice lines, customers and exchange rates.\nCode: Commit history, identity maps and scan results.\nDelivery: Sprints and issues from the delivery tracker.\nDocuments: Contracts and data-room files.\nManagement reporting: The KPIs and ARR the seller reports.\nThe loop, the same for every deal and every industry:\nEvidence — Collect the evidence: Billing records, repositories, delivery data and documents — normalized, hashed and kept with their source.\nFinding — Draft the findings: Analysts, scanners and models draft issues that cite the evidence they rest on.\nReview — A person decides: A named reviewer accepts, rejects or asks for support. Nothing is accepted by a machine.\nAssumption — Price the risk: Accepted risks become explicit, versioned inputs with a price range and a basis.\nValuation — Run the numbers: Deterministic scenarios and a purchase-price bridge, run from stored inputs.\nDeal terms — Set the terms: Price adjustments, escrows and indemnities, each tied to the risk that justified it.\nClaude assists. People decide. Pactlab uses Claude to read, compare and draft. The decisions stay with the deal team.\nHumans decide: AI extracts, compares and drafts. It never approves a finding, sets a price or makes a legal call.\nDeterministic numbers: Money, KPIs and scenarios come from versioned calculations and decimal arithmetic, not model prose.\nCitations required: No citation that resolves, no accepted finding.\nPeople data protected: Aggregate by default. HR, compensation and performance data never reach a model.",
    "locale": "en"
  },
  {
    "id": "how-it-works:model-routing",
    "kind": "HOW_IT_WORKS",
    "title": "The right model for every document. You never have to choose.",
    "url": "https://pactlab.ai/how-it-works/",
    "text": "A data room is agreements, leases, financial statements, scans and charts — and no single AI model is best at all of them. Pactlab routes each job to the frontier model that does it best: one for deep agreement review, another for consistency checks, another for high-volume extraction, another for documents that arrive as images. You don’t pick models, write prompts, or triage documents. Pactlab does — and every finding still arrives with its citation, ready for your review.\nFrontier models from Anthropic, OpenAI and Google — routed per job, swapped as the frontier moves.\nDeep review: Frontier reasoning models read agreements end to end, so findings rest on the whole document, not a summary.\nConsistency checks: A dedicated pass checks defined terms, cross-references and party names across every agreement.\nExtraction at scale: High-volume models pull the fields from leases and financials, including scans and tables, without the flagship price.\nMost platforms make you choose an AI model and live with its weaknesses. Pactlab routes each kind of work — review, consistency checks, extraction, image documents — to the model that does it best, and re-routes as better models arrive. Your workflow never changes.",
    "locale": "en"
  },
  {
    "id": "product:revenue",
    "kind": "PRODUCT",
    "title": "Revenue and SaaS metrics",
    "url": "https://pactlab.ai/product/revenue/",
    "text": "Recurring revenue rebuilt from billing records and reconciled to what management reports.\nIs the ARR in the deck the ARR in the ledger?\nPactlab rebuilds recurring revenue from invoice lines rather than from the data book, so every metric traces to the transactions behind it.\nRevenue ledger: MRR and ARR rebuilt from billing records, with currency conversion at recorded rates.\nRetention: Gross and net revenue retention, expansion, contraction, churn and reactivation.\nCohorts: Revenue and logo cohorts by start month, so a strong year cannot hide a weak vintage.\nConcentration: Share of revenue held by the largest customers, and how it has moved.\nReconciliation: Management ARR set against billed ARR. A reviewer approves the difference, or it stays open.\nExplanations: Every figure shows its formula, time basis, inclusion rules and the source rows behind it.\nWhat you get: A reconciled revenue view with an approved bridge from reported to billed ARR.",
    "locale": "en"
  },
  {
    "id": "product:technology",
    "kind": "PRODUCT",
    "title": "Technology and code",
    "url": "https://pactlab.ai/product/technology/",
    "text": "Commit history, ownership and licence exposure, read from the repository rather than the interview.\nWho really built this, and what comes with it?\nPactlab reads commit metadata and scan results, never keeps the source, and ties every technical finding to the exact commit and tool version that produced it.\nCommit provenance: Every finding resolves to a full commit hash, the tool that produced it and that tool’s version.\nUnattributed commits: Work by identities missing from the identity map, or committed after a recorded departure.\nKey-person concentration: Subsystems that depend on one contributor, reported as aggregates and never as a ranking of people.\nLicence exposure: Components and licences from a software bill of materials, checked against a licence policy.\nScanner findings: Security and quality signals from isolated, short-lived scans.\nSource never kept: Scan workspaces are destroyed on success, failure, timeout or cancellation. Paths and hashes remain; code does not.\nWhat you get: Technology findings, each tied to a commit, a tool version and the evidence it cites.",
    "locale": "en"
  },
  {
    "id": "product:delivery",
    "kind": "PRODUCT",
    "title": "Delivery health",
    "url": "https://pactlab.ai/product/delivery/",
    "text": "Sprint and issue history that shows whether the roadmap is being delivered.\nCan this team ship what the plan assumes?\nPactlab reads sprints and issues from the delivery tracker and surfaces the trends a roadmap slide leaves out. It reads delivery facts only, not names, comments or descriptions.\nCompletion against commitment: Points committed and completed, sprint by sprint.\nDefect backlog: Open bugs by priority and age, and which way the backlog is moving.\nReopened work: Fixes that came back — a signal estimates and burndown charts miss.\nGaps, not guesses: Unestimated work, open-ended sprints and unreadable projects are reported, never filled in.\nWhat you get: Delivery trends and source gaps, ready to become findings.",
    "locale": "en"
  },
  {
    "id": "product:documents",
    "kind": "PRODUCT",
    "title": "Documents and contracts",
    "url": "https://pactlab.ai/product/documents/",
    "text": "Contract terms extracted with exact, page-level citations.\nWhat did they actually sign?\nPactlab extracts parties, dates and clauses from deal documents and answers questions about them. Every statement points to the exact passage it came from.\nExact citations: Each answer quotes the page it relies on. A claim whose quote cannot be found is rejected.\nClause extraction: Change of control, assignment, termination, exclusivity and other terms, drafted for review.\nInjection-aware: Instructions hidden inside documents are treated as data. Answers that cite them are blocked.\nSecure uploads: Malware-scanned, tenant-scoped storage with retention classes and legal hold.\nAI exclusion: HR, compensation and performance documents are never sent to a model.\nWhat you get: Contract findings with exact citations, accepted only by a named reviewer.",
    "locale": "en"
  },
  {
    "id": "product:findings",
    "kind": "PRODUCT",
    "title": "Findings and review",
    "url": "https://pactlab.ai/product/findings/",
    "text": "One place where every issue is drafted, evidenced, priced and decided.\nWhich risks are real, and what are they worth?\nAnalysts, scanners and models can draft findings. Only people decide them. Every decision is recorded with who made it and why.\nEvidence links: A finding cannot be accepted until its evidence resolves to a source record.\nPriced risk: Price reductions, escrows, indemnities and remediation costs as decimal ranges with a stated basis.\nHuman decisions: Submit, accept, reject or ask for support — each with a rationale and a named reviewer.\nAppend-only history: Reviews and earlier evidence are never overwritten, so the decision trail stays complete.\nWhat you get: A register of accepted, priced risks that feeds valuation.",
    "locale": "en"
  },
  {
    "id": "product:valuation",
    "kind": "PRODUCT",
    "title": "Sextant: valuation and deal terms",
    "url": "https://pactlab.ai/product/valuation/",
    "text": "Sextant turns accepted risks into scenarios and a purchase-price bridge, frozen when submitted and approved by a second person.\nWhat should we pay, and on what terms?\nSextant, Pactlab’s instrument for smart M&A, turns accepted risks into explicit adjustments and runs deterministic valuation scenarios. Change a risk and every scenario that depends on it is marked stale.\nMethods: ARR multiples and discounted cash flow, with LBO returns for take-private deals.\nSensitivities: Two-way tables on the inputs that move value most.\nPurchase-price bridge: From enterprise value to equity price: cash, debt, debt-like items, working capital and risk adjustments.\nStale on change: Re-price or reject an accepted risk and dependent results are flagged until they are re-run.\nFrozen submissions: A submitted scenario is stored byte for byte with its digest and never rewritten.\nFour eyes: The person who submits a valuation cannot approve it.\nWhat you get: An approved, frozen valuation whose every adjustment traces to an accepted finding.",
    "locale": "en"
  },
  {
    "id": "product:close",
    "kind": "PRODUCT",
    "title": "Two-sided close",
    "url": "https://pactlab.ai/product/close/",
    "text": "Terms proposed, countered and agreed by both sides in one place, signed through your own DocuSign, with funds confirmed.\nDid both sides agree to the same thing?\nThe negotiation and the close happen in the pact, not across email threads. Either side proposes, the other answers, and the version both sides sign is the version the price came from.\nPropose and counter: Buyer or seller proposes a version; the other side accepts, rejects or counters each term, starting with the headline price.\nTerms tied to risk: Each escrow, indemnity or price adjustment keeps its link to the finding that justified it.\nNamed signatories: Each side names who signs. Once they sign the current version, the name is fixed.\nYour own DocuSign: Envelopes go out from your organization’s DocuSign account, carrying the term sheet Pactlab generated from the agreed version.\nFunds confirmed: The buyer records each payment; the seller reviews and confirms it, or disputes it.\nEvery version kept: Every proposal, counter and sign-off stays on record, so the history of the deal is never rewritten.\nWhat you get: An agreed version signed by both sides, with its term sheet’s fingerprint recorded and the closing checklist confirmed.",
    "locale": "en"
  },
  {
    "id": "product:reports",
    "kind": "PRODUCT",
    "title": "Reports",
    "url": "https://pactlab.ai/product/reports/",
    "text": "An executive view across every deal, and the complete record of one pact as a PDF you can forward.\nWhat do I send the investment committee?\nReports turn what the deal team has already reviewed into a document for the people who were not in the room. Each report is a versioned snapshot: generate a new one and the old one stays exactly as it was.\nExecutive report: Every pact your organization can see, by phase, with priced exposure and the largest open risks, totals traceable to the pacts below them.\nPact report: One pact end to end: evidence, findings with their priced impact, valuation and bridge, terms and the post-close register.\nVersioned snapshots: Every report is numbered and never rewritten, stamped with when its data was taken and who generated it.\nYour side’s view only: A report holds only what the person who generated it may see. A seller’s report never shows the buyer’s pricing.\nAudited: Every generation and every download is recorded in the audit trail.\nReady to forward: A paginated PDF with every page marked with its version, its data date and who it is confidential to.\nWhat you get: A versioned PDF for the committee, the board or the lender, built from reviewed work and never edited after the fact.",
    "locale": "en"
  },
  {
    "id": "product:assistant",
    "kind": "PRODUCT",
    "title": "Pactlab in your AI assistant",
    "url": "https://pactlab.ai/product/assistant/",
    "text": "Ask Claude or another MCP-ready assistant about your pacts, with answers drawn from Pactlab and cited to the evidence.\nCan I ask about the deal where I already work?\nPactlab has an MCP server, so Claude and other assistants that support MCP can read your pacts on your behalf. You sign in to Pactlab once, approve the connection, and the assistant sees exactly what you can see.\nConnect in a minute: Add Pactlab as a connector, sign in, approve. Disconnect any time from Settings.\nFindings, claims and valuation: List your deals, read findings and the claims register, and walk through the purchase-price bridge.\nWhat-if scenarios: Ask what the price looks like under different assumptions. The answer comes from the same calculations, and nothing is saved.\nCited answers: Search the evidence and get answers that point back to the source documents.\nYour permissions, read-only: The assistant reads with your access and changes nothing. Confidential value data needs a separate grant.\nEvery call audited: Each tool the assistant uses is recorded, by person, app and deal. Questions and answers are never logged.\nWhat you get: Answers about your pacts inside the assistant you already use, with Pactlab’s permissions and audit trail behind every one.",
    "locale": "en"
  },
  {
    "id": "guide:saas-acquisition-due-diligence",
    "kind": "GUIDE",
    "title": "How do you run due diligence on a SaaS acquisition?",
    "url": "https://pactlab.ai/guides/saas-acquisition-due-diligence/",
    "text": "SaaS diligence comes down to one question: does the evidence support the number you are about to pay? Work from the source records, not the summaries, and let every finding carry its citation into the price.\n1. Rebuild recurring revenue from billing\nManagement ARR is a claim. Rebuild MRR and ARR from invoice lines in the billing export, then reconcile the two and explain the difference.\nAnnualize the latest month from billing, not from a pipeline or bookings report.\nSeparate new, expansion, contraction and churn by month.\nLook for contraction hidden behind a stable logo count.\nMeasure customer concentration: the share of revenue from the largest customers.\n2. Test retention by cohort\nNet and gross revenue retention by signup cohort, not one blended figure.\nWhether recent cohorts behave like older ones.\nWhich customers drive the net expansion.\n3. Read the contracts that move the price\nChange-of-control and termination-for-convenience clauses in the largest customer contracts.\nPrice-review and most-favoured-customer terms.\nDebt and debt-like items on the balance sheet.\n4. Check the code and the team behind it\nRead the repository history for ownership and key-person risk, licence exposure, and whether delivery matches the roadmap. See the technical diligence guide for the detail.\n5. Keep a claims register\nList what the seller says — ARR, churn, headcount, runway — next to what the evidence shows, and mark each as confirmed, contradicted or unverified. A contradicted claim is usually a finding.\n6. Price what you find\nValue with an ARR multiple and a DCF on reconciled numbers. Link each accepted, priced finding to the price bridge as an adjustment, so the gap between the asking price and the supported value is explained line by line.\nHow Pactlab does it\nPactlab imports the billing export, rebuilds the revenue ledger, reads the repository and documents, and drafts findings with citations. A named reviewer accepts or rejects each one; accepted findings flow into versioned valuation scenarios and the price bridge.",
    "locale": "en"
  },
  {
    "id": "guide:technical-due-diligence-with-ai",
    "kind": "GUIDE",
    "title": "How do you do technical due diligence on a software acquisition with AI?",
    "url": "https://pactlab.ai/guides/technical-due-diligence-with-ai/",
    "text": "Technical diligence asks whether the product can keep being built after the deal closes, by whom, and at what risk. AI is useful for reading large histories quickly; the judgments stay with people.\nWhat to read\nCommit history: who works on which parts of the code, and how that has changed.\nOwnership: areas with a single maintainer, and contributors who have left.\nDependencies and licences: copyleft or unknown licences in shipped code.\nDelivery: sprint commitments versus completion, cycle time and reopened work.\nPull requests and reviews: whether changes are reviewed before they ship.\nWhere AI helps\nReading thousands of commits, issues and pull requests, grouping them by code area, and drafting findings such as “one person owns the billing service”. Every drafted finding must cite the commits or issues behind it.\nWhere people decide\nWhether a key-person dependency matters, what a retention plan should be, and how a risk is priced. People data needs care: use aggregates by default, gate named views, and never send compensation or performance data to a model.\nKeep the source code out of the file\nScan in an isolated, short-lived workspace and keep only findings, paths, hashes and tool versions. Diligence does not need a copy of the target’s code.\nHow Pactlab does it\nPactlab connects to GitHub and Jira, reads metadata and history, and shows ownership, delivery health and key-person risk at team scale. Findings carry their citations into review and, once accepted and priced, into valuation.",
    "locale": "en"
  },
  {
    "id": "guide:prepare-for-vc-due-diligence",
    "kind": "GUIDE",
    "title": "How should a founder prepare for VC due diligence?",
    "url": "https://pactlab.ai/guides/prepare-for-vc-due-diligence/",
    "text": "Investors test what your deck says against your records. Run the same test first, fix what you can, and explain what you cannot — before it becomes a negotiating point.\nCheck your numbers against your records\nARR in the deck versus ARR from your billing system for the latest month.\nRunway in the deck versus cash divided by the last three months’ net burn.\nCustomer concentration: how much revenue your largest customers represent.\nCheck your cap table\nIssued shares match the certificate of incorporation and board consents.\nEvery SAFE and note: cap, discount and most-favoured-nation terms — an MFN clause can convert an early SAFE on a later, lower cap.\nThe option pool the investor will ask for, and whether it comes out of the pre-money.\nCheck ownership of what you built\nIP assignment in every founder, employee and contractor agreement.\nFounder vesting and tax elections on file.\nCompare offers on what you keep\nFor each term sheet, model the round: price per share, SAFE conversion, pool and founder ownership after closing. The headline pre-money is not the whole answer.\nHow Pactlab does it\nVenture Raise imports your billing export, cap table and monthly financials, reads your documents, and flags each gap with its source. The Raise tab models every offer side by side, and the investor view shares only the verified numbers you choose.",
    "locale": "en"
  },
  {
    "id": "faq:acquirers-1",
    "kind": "FAQ",
    "title": "How does AI due diligence work on a software acquisition?",
    "url": "https://pactlab.ai/faq/acquirers/",
    "text": "Pactlab reads the evidence directly: the billing export, the code repository and its history, the issue tracker and the documents in the data room. It rebuilds recurring revenue from billing records, reads ownership and licence exposure from the repository, and extracts contract terms with page-level citations. AI drafts findings from that evidence; a named reviewer accepts, rejects or asks for support. Calculations such as ARR, retention and valuation are deterministic code, not model output.",
    "locale": "en"
  },
  {
    "id": "faq:acquirers-2",
    "kind": "FAQ",
    "title": "What does Pactlab check that a data room does not?",
    "url": "https://pactlab.ai/faq/acquirers/",
    "text": "A data room stores documents. Pactlab tests what they claim. It compares what management reports — ARR, churn, runway, headcount — with what the billing records, the repository and the contracts show, and records each comparison in a claims register as confirmed, contradicted or unverified, with the source of both sides.",
    "locale": "en"
  },
  {
    "id": "faq:acquirers-3",
    "kind": "FAQ",
    "title": "Can the AI approve a finding or set the price?",
    "url": "https://pactlab.ai/faq/acquirers/",
    "text": "No. AI extracts, classifies, compares and drafts. A finding becomes accepted only when a person accepts it, and an AI finding without a resolvable citation cannot be accepted at all. Prices come from valuation scenarios built on versioned assumptions that a person approves.",
    "locale": "en"
  },
  {
    "id": "faq:acquirers-4",
    "kind": "FAQ",
    "title": "How do findings change the valuation?",
    "url": "https://pactlab.ai/faq/acquirers/",
    "text": "An accepted, priced finding links to the valuation as an adjustment on the price bridge. If the finding or its evidence changes, every scenario that depends on it is marked stale until it is re-run, so the price never silently rests on a finding that has moved.",
    "locale": "en"
  },
  {
    "id": "faq:acquirers-5",
    "kind": "FAQ",
    "title": "Does Pactlab keep the target’s source code?",
    "url": "https://pactlab.ai/faq/acquirers/",
    "text": "No. Code is read in an isolated, short-lived workspace that is destroyed afterwards. Pactlab keeps normalized findings, file paths, hashes and tool versions — not the source.",
    "locale": "en"
  },
  {
    "id": "faq:acquirers-6",
    "kind": "FAQ",
    "title": "How is the target’s people data handled?",
    "url": "https://pactlab.ai/faq/acquirers/",
    "text": "People appear as aggregates by default. Named views are gated, reads are audited, small groups are suppressed, and HR, compensation and named contribution data are never sent to an AI model.",
    "locale": "en"
  },
  {
    "id": "faq:acquirers-7",
    "kind": "FAQ",
    "title": "Which industries does Pactlab cover?",
    "url": "https://pactlab.ai/faq/acquirers/",
    "text": "Software and SaaS is the core. Industry packs add the sources, checks and valuation methods for fintech, healthcare services, hospitals, small clinics, telecom and media, professional services, pharma and biotech, e-commerce, multifamily, commercial property and hotels. Each pack keeps the same review and citation rules.",
    "locale": "en"
  },
  {
    "id": "faq:founders-1",
    "kind": "FAQ",
    "title": "How do I prepare for VC due diligence?",
    "url": "https://pactlab.ai/faq/founders/",
    "text": "Check your own claims against your own records before an investor does. The usual gaps are a deck ARR that billing does not support, a runway calculated on an old burn rate, SAFEs that convert into more of the company than you expect, and contractor work without an IP assignment. Venture Raise runs those checks on your billing export, cap table, monthly financials and documents, and shows each gap with its source.",
    "locale": "en"
  },
  {
    "id": "faq:founders-2",
    "kind": "FAQ",
    "title": "What do investors check in a seed round?",
    "url": "https://pactlab.ai/faq/founders/",
    "text": "Typically: revenue and its quality, burn and runway, the cap table and how outstanding SAFEs and notes convert, ownership of the IP, the founders’ vesting and tax elections, key contracts, and board composition after the round. Pactlab’s readiness checklist shows which of these your data room already answers for an angel and for a venture fund.",
    "locale": "en"
  },
  {
    "id": "faq:founders-3",
    "kind": "FAQ",
    "title": "How do I compare term sheets from several investors?",
    "url": "https://pactlab.ai/faq/founders/",
    "text": "Record each offer — pre-money, amount, pool target, liquidation preference, board seats — on the Raise tab. Pactlab models the round for each one, including SAFE conversion and the option-pool shuffle, and shows price per share and founder ownership side by side.",
    "locale": "en"
  },
  {
    "id": "faq:founders-4",
    "kind": "FAQ",
    "title": "What does an investor see if I share my Pactlab workspace?",
    "url": "https://pactlab.ai/faq/founders/",
    "text": "Only the investor view you choose to share: verified numbers and the documents you select. Your findings, runway analysis and the other offers stay on your side.",
    "locale": "en"
  },
  {
    "id": "faq:founders-5",
    "kind": "FAQ",
    "title": "Does Pactlab tell me what my company is worth?",
    "url": "https://pactlab.ai/faq/founders/",
    "text": "It models what each offer means for your ownership and checks the evidence behind your numbers. The valuation itself is what you and your investors agree; Pactlab never sets it.",
    "locale": "en"
  },
  {
    "id": "faq:advisors-1",
    "kind": "FAQ",
    "title": "How does Pactlab fit an advisor’s diligence process?",
    "url": "https://pactlab.ai/faq/advisors/",
    "text": "Pactlab is the workspace where evidence, findings and valuation stay connected. You load the client’s or target’s billing export, repository, issue tracker and documents; Pactlab drafts findings with citations; you review them; accepted findings flow into valuation scenarios and proposed deal terms.",
    "locale": "en"
  },
  {
    "id": "faq:advisors-2",
    "kind": "FAQ",
    "title": "Can every number in a report be traced back?",
    "url": "https://pactlab.ai/faq/advisors/",
    "text": "Yes. Each figure resolves to the evidence it came from — a billing line, a commit, a document page — and each accepted finding records who accepted it and when.",
    "locale": "en"
  },
  {
    "id": "faq:advisors-3",
    "kind": "FAQ",
    "title": "Are client deals kept separate?",
    "url": "https://pactlab.ai/faq/advisors/",
    "text": "Yes. Every deal row carries its organization and deal identity, and isolation is enforced in the database with row-level security, not only in the interface. Target contributors never see buyer-only findings, valuation or negotiation terms unless they are explicitly shared.",
    "locale": "en"
  },
  {
    "id": "faq:advisors-4",
    "kind": "FAQ",
    "title": "Which valuation methods are available?",
    "url": "https://pactlab.ai/faq/advisors/",
    "text": "ARR multiple and discounted cash flow for software, plus pack methods where the sector needs them: NOI and cap rate for property, payer-mix-adjusted EBITDA for hospitals, and round pre-money for founders raising. Each scenario stores its assumptions as a version.",
    "locale": "en"
  },
  {
    "id": "faq:advisors-5",
    "kind": "FAQ",
    "title": "Can we use our own data templates?",
    "url": "https://pactlab.ai/faq/advisors/",
    "text": "Billing exports from common systems map through column matching onto Pactlab’s standard template, and each industry pack publishes a CSV template for its extracts, such as a rent roll or a loan tape.",
    "locale": "en"
  },
  {
    "id": "guide:compare-valuation-software",
    "kind": "GUIDE",
    "title": "Pactlab compared with M&A valuation software",
    "url": "https://pactlab.ai/compare/valuation-software/",
    "text": "Valuation software models a deal from the financial statements you enter. Pactlab starts earlier: it tests the evidence behind those statements, records what it finds, and carries the accepted findings into the valuation. The two answer different questions, and many teams use both.\nStarting point: Source records: billing exports, code repositories, issue trackers, documents and industry extracts.\nDiligence findings: Drafts findings from the evidence, each with a citation; a named reviewer accepts, rejects or asks for support.\nValuation: Versioned scenarios (ARR multiple, DCF and sector methods) with accepted findings linked to the price bridge.\nCode and delivery: Reads repository history and issue trackers for ownership, licences and delivery health; never keeps the source code.\nComparable deal data: Comparables recorded with their source, alongside the evidence-based scenarios.\nReports: Findings, the claims register, valuation scenarios and proposed deal terms, each traceable to evidence.\nWhere it runs: In the browser, with each deal isolated by row-level security in the database.\nUse valuation software to model a deal from agreed financials. Use Pactlab to establish which financials the evidence supports, what risks it shows, and how those findings change the price — with a person signing off each step.",
    "locale": "en"
  },
  {
    "id": "industry:software-saas",
    "kind": "INDUSTRY",
    "title": "Software and SaaS in Pactlab",
    "url": "https://pactlab.ai/industries/software-saas/",
    "text": "The baseline: recurring revenue, code, delivery, contracts and valuation for software acquisitions.\nStrategic and private-equity acquisitions of software and SaaS companies, from tuck-ins to take-privates.\nDoes billed revenue support the ARR management reports?\nHow sticky is revenue by cohort, and how concentrated is it?\nWho wrote the code, and does the business depend on one person?\nWhat licence and security exposure ships with the product?\nCan the team deliver the roadmap the plan assumes?\nWhich contract terms change at closing?\nFive years of history: December ARR, net and gross revenue retention and logo churn by year from the billing export, beside the P&L, with how many years each figure rests on; a missing year is asked of the seller.",
    "locale": "en"
  },
  {
    "id": "industry:fintech",
    "kind": "INDUSTRY",
    "title": "Fintech in Pactlab",
    "url": "https://pactlab.ai/industries/fintech/",
    "text": "Payments and lending economics checked against processor and licence evidence, on top of the software baseline.\nAcquisitions of payments, lending and embedded-finance companies, often by strategic buyers and growth equity.\nDo the processor exports support the TPV, growth and take rate in the deck?\nIs every licence and sponsor agreement current, and for how long?\nAre chargeback and fraud-loss rates inside the thresholds the sponsor agreement sets?\nIs any cost, such as fraud losses, growing faster than revenue year on year?\nIs the allowance adequate for the losses on the loan tape?\nVolume and take rate, recomputed: Processed volume, transactions and the effective take rate from the processor exports, reconciled to the deck and the P&L.\nA claims register: TPV, growth, take-rate and retention claims marked verified, contradicted or unverified against the evidence.\nLicences and sponsor agreements: Each with its status and expiry from the register and the documents; a lapse or near expiry becomes a finding.\nLoss rates and compliance evidence: Chargeback and fraud-loss rates by quarter against stated thresholds; PCI, AML and exam evidence shown as present or absent.\nFive years of history: The P&L, volume, take rate and loss rate by year, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: Processor and bank settlement exports: volume, transactions, net revenue, chargebacks and fraud losses; The licence and sponsor-bank register, with the licences and agreements themselves; The loan tape and transaction-monitoring alerts; Up to five years of the P&L and of the processor exports; The deck, the AML procedure, the PCI attestation and exam reports\nFindings: A deck claim for TPV, growth or take rate the processor exports contradict, or that nothing supports; A licence or sponsor agreement that has lapsed, or expires within 90 days; A quarter’s chargeback or fraud-loss rate over the threshold the sponsor agreement states; P&L payments revenue that does not reconcile to the processor exports; Fraud losses or another key cost growing faster than revenue across the years; A take rate falling, or a loss rate rising, every year across five years; An allowance below observed loan losses, and alerts closed without review evidence; A PCI attestation more than a year old, or a consent order on file\nValuation: ARR multiple and DCF, as for any software business; Contradicted claims, loss-threshold breaches and lapsed licences as reviewer-priced drags or closing conditions; Verified claims recorded as confirmed value only, never as a price increase",
    "locale": "en"
  },
  {
    "id": "industry:healthcare",
    "kind": "INDUSTRY",
    "title": "Healthcare services and healthtech in Pactlab",
    "url": "https://pactlab.ai/industries/healthcare/",
    "text": "Multi-site provider deals checked against remittances, credentials and contracts: payer mix, denials, credentialing and clinician concentration.\nPrivate-equity roll-ups of practices, clinics and payer-adjacent services; healthtech software targets follow the baseline path.\nDo the remittances support the denial rate, payer mix and days in receivable in the deck?\nIs the payer mix drifting toward payers that pay less per claim?\nIs every clinician’s licence current, and did anyone keep collecting after theirs expired?\nDoes one clinician carry the collections, and are they bound by a non-compete?\nDo the P&L, the payer contracts and the compliance evidence hold up year on year?\nCollections and payer mix, recomputed: Collections, denial rate, days in receivable and the payer mix from the remittances, reconciled to the deck and the P&L.\nA claims register: Denial-rate, payer-share and days-in-receivable claims marked verified, contradicted or unverified against the evidence.\nCredentialing, checked: Every rostered clinician’s licence and expiry from the register and the verification documents; collections after an expiry become a finding.\nClinician concentration: Each clinician’s share of collections against the non-compete and retention schedule.\nFive years of history: Visits, the commercial share and the denial rate by year, beside the P&L, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: Remittance or billing exports by payer: claims, denials, charges, collections and receivables; Collections by clinician, by pseudonymous reference; The provider roster, the credentialing register and licence verifications; The payer contract register, the non-compete and retention schedule, coding audits and the HIPAA risk assessment; The P&L for every fiscal year imported, and the deck\nFindings: A deck claim for the denial rate, payer mix or days in receivable the remittances contradict, or that nothing supports; A denial rate or days in receivable rising year on year, and a payer mix drifting toward the lowest-paying payer; A clinician still collecting after their licence expired, a licence expiring within 90 days, or none on file; One clinician carrying a large share of collections with no non-compete or retention agreement on file; A payer contract that has ended or ends within a year without renewal; P&L patient revenue that does not reconcile to collections, and denial write-offs or another key cost outpacing revenue; A medical-director fee above documented duties, and an out-of-date risk assessment or coding audit\nValuation: DCF, with ARR multiple for healthtech targets; Contradicted claims, denial and payer-mix drift and expired licences as reviewer-priced drags or closing conditions; Verified claims recorded as confirmed value only, never as a price increase",
    "locale": "en"
  },
  {
    "id": "industry:telecom-media",
    "kind": "INDUSTRY",
    "title": "Telecom and media in Pactlab",
    "url": "https://pactlab.ai/industries/telecom-media/",
    "text": "Subscriber businesses priced on churn, ARPU and the agreements their content and distribution run on. Pactlab checks the claims against the billing exports and the dates against the closing.\nAcquisitions of connectivity, cable, streaming and regional media businesses.\nDo the billing exports support the subscribers, churn and ARPU in the deck?\nWhich content, affiliate or carriage agreements end soon after the closing?\nDoes one advertiser or distributor carry the revenue?\nAre content costs and capex rising while ARPU stands still?\nSubscriber claims, recomputed: Subscribers, churn and ARPU from the movements export, marked verified, contradicted or unverified against the deck.\nRights windows: Every content, affiliate and carriage agreement’s end date against the expected closing; the agreement’s own date governs over the register.\nCounterparty concentration: Advertising and affiliate revenue by counterparty over the trailing twelve months.\nContent cost against ARPU: Content cost per subscriber and capex intensity by year, against ARPU from the same exports.\nFive years of history: Subscribers, churn and ARPU by year from the movements export, beside the P&L, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: Subscriber billing and CRM exports: subscribers by month, and opening, additions, disconnects and service revenue by region and plan; The rights and carriage register, and the content, affiliate and carriage agreements themselves; Advertising and affiliate statements, by counterparty; Capital expenditure and the P&L by year, the KPI pack and the investor presentation\nFindings: A subscriber, churn or ARPU claim the billing export contradicts; A material agreement ending within 12 months of the closing; One advertiser or distributor carrying a large share of its stream; Content cost per subscriber or capex rising against flat ARPU; Reported subscribers above the billed count, and regional concentration\nValuation: No change to the valuation methods; Recomputed churn and ARPU as scenario inputs; Renewal and counterparty exposures priced by the reviewer on the purchase-price bridge",
    "locale": "en"
  },
  {
    "id": "industry:professional-services",
    "kind": "INDUSTRY",
    "title": "IT and professional services in Pactlab",
    "url": "https://pactlab.ai/industries/professional-services/",
    "text": "Services firms priced on fee-earner economics: utilization, realization, and how much of the book walks out with two partners.\nSteady roll-up activity by private equity and strategic acquirers in agencies, consultancies and managed-service firms.\nIs utilization what management says, and is realization holding year on year?\nHow much of the fees sits with one client, or with one partner’s book?\nWhich partners carrying the book are bound by a non-compete or non-solicit?\nIs old WIP or unpaid debt building up?\nUtilization and realization: Utilization from the timesheets; realization and collection recomputed from the time-and-billing export by year, and fees reconciled to the P&L.\nRainmaker cover: Each revenue-carrying partner’s book against the non-compete and non-solicit cover the documents show, by pseudonymous reference.\nWIP and debtor ageing: Balances over 90 days by year end, with the drift priced into working capital.\nRevenue quality: Retainer and managed-service fees against project work, from the billing data.\nFive years of history: Utilization, realization and headcount by year, beside the P&L, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: Time-and-billing exports: hours, standard value, fees billed and collected, by client and fee-earner; Timesheet summaries and headcount movements, in aggregate; WIP and debtor ageing reports, by year end; The restrictive covenant register, client agreements and the information memorandum; The P&L by year\nFindings: A top client or partner book above the ceiling the deck states; Utilization below the reported level, and realization falling across years; A rainmaker with no non-compete or non-solicit on file; WIP or debtors over 90 days drifting up, priced; Recurring against project revenue, and the largest client terminable for convenience\nValuation: No change to the valuation methods; Realization and concentration as scenario inputs; Ageing drift priced into working capital on the purchase-price bridge",
    "locale": "en"
  },
  {
    "id": "industry:pharma-biotech",
    "kind": "INDUSTRY",
    "title": "Pharma and biotech in Pactlab",
    "url": "https://pactlab.ai/industries/pharma-biotech/",
    "text": "Deals priced on pipeline claims and a patent estate, where the checkable failures are consistency failures.\nAcquisitions and licensing deals for pharmaceutical and biotechnology assets and companies.\nDoes the phase each programme is claimed to be in match what is filed with the registry and the regulator?\nWhen does the patent protection on each product end, and does that fall inside the hold?\nDoes the seller’s model carry every milestone, royalty and fee the licence agreements require?\nIs R&D spend keeping pace with the timeline the seller now claims?\nA pipeline claims register: Each programme’s phase, status and readout date marked verified, contradicted or unverified against the filings supplied.\nThe patent estate against the hold: Expiries read from the patent records, and a cliff inside the hold priced on the product’s revenue.\nObligations recomputed: Milestones, royalties and fees read from the agreements and looked for in the seller’s model.\nDependence: Single-source manufacturing from the supply agreements, and key-scientist concentration from the roster.\nFive years of history: Each product’s billed revenue and R&D by year, beside the P&L, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: The pipeline schedule and the trial-registry records the seller supplies; Regulatory correspondence and meeting minutes; The patent schedule and patent records; Licence and collaboration agreements, and the seller’s model of what they cost; Supply agreements, the R&D roster by pseudonymous reference and the P&L by year\nFindings: A claimed phase or readout date the registry filings contradict; A key patent expiring inside the hold; A milestone, royalty or fee missing from the seller’s model; Single-source manufacturing and key-scientist concentration; R&D spend flat while the timeline is brought forward\nValuation: DCF, with exclusivity and timing as scenario inputs; Patent cliffs and omitted obligations priced on the purchase-price bridge",
    "locale": "en"
  },
  {
    "id": "industry:ecommerce-dtc",
    "kind": "INDUSTRY",
    "title": "E-commerce and DTC in Pactlab",
    "url": "https://pactlab.ai/industries/ecommerce-dtc/",
    "text": "Consumer-brand deals priced on lifetime value claims and on revenue that may run through accounts the seller owns personally.\nAggregators and roll-ups acquiring consumer and direct-to-consumer brands.\nDoes the lifetime value in the deck hold up on a contribution-margin basis?\nDoes revenue by channel in the exports tie to the P&L, year by year?\nWho holds the storefront, marketplace and ad accounts the revenue runs through?\nHow much of the stock is old, and what is it worth?\nChannel revenue verified: Net sales by channel recomputed from the storefront and marketplace exports and reconciled to the P&L by year.\nCohort value on contribution: Lifetime value and acquisition cost recomputed from the orders, cohorts and ad spend, against the deck’s claims.\nWho holds the accounts: Each storefront, marketplace and ad account’s share of revenue, and who the documents say it is registered to.\nReturns and stock age: The return rate by year, and stock older than 180 days priced from the stock report.\nFive years of history: Orders, order value, repeat orders and the discount rate by year, beside the P&L, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: Storefront and marketplace order exports, by month, channel and account; Repeat purchase by first-purchase cohort, and ad-platform spend exports; The stock report; Platform account records, marketplace terms and the investor presentation; The P&L by year\nFindings: A lifetime value or acquisition cost the exports contradict; Channel revenue that does not reconcile to the P&L; A material storefront, marketplace or ad account held personally; Stock older than 180 days, priced; Acquisition cost rising and contribution compressing across years\nValuation: No change to the valuation methods; Unit economics on a contribution basis as scenario inputs; Aged stock priced on the purchase-price bridge",
    "locale": "en"
  },
  {
    "id": "industry:multifamily",
    "kind": "INDUSTRY",
    "title": "Multifamily in Pactlab",
    "url": "https://pactlab.ai/industries/multifamily/",
    "text": "Apartment acquisitions where the rent roll, not the offering memorandum, sets the income you pay for.\nAcquisitions of apartment communities and portfolios by real-estate private equity and operators.\nDoes the rent roll support the income in the offering memorandum?\nHow far are in-place rents below market, and is that upside real?\nHow much deferred maintenance comes with each unit?\nIs delinquency spread out or concentrated?\nHas occupancy held over five years, and have rents kept pace with expenses?\nProperty operating data: Adapters for rent rolls, T-12s, delinquency reports, utility bills and inspections.\nFive years of history: Income, expenses, rent and occupancy by year, with how many years each figure rests on; a missing year is asked of the seller.\nLoss-to-lease and delinquency findings: In-place rents against market, and where delinquency concentrates.\nNOI and cap-rate valuation: Net operating income and capitalization rate, with capex per door as remediation.\nEvidence: Rent roll; Trailing-twelve-month operating statement (T-12); Five years of income and expenses; Five years of rent and occupancy; Lease files; Delinquency reports; Utility bills; Unit-condition inspections\nFindings: Loss-to-lease; Deferred maintenance per door; Delinquency concentration; Occupancy erosion; Expenses outpacing rent; A last-year NOI spike\nValuation: Net operating income and capitalization rate; Loss-to-lease upside as confirmed value, never a price increase; Capital expenditure per door as remediation",
    "locale": "en"
  },
  {
    "id": "industry:small-clinics",
    "kind": "INDUSTRY",
    "title": "Small clinics in Pactlab",
    "url": "https://pactlab.ai/industries/small-clinics/",
    "text": "Clinics of a few sites, where the risks concentrate: one owner-operator, one referral source, one lease.\nPrivate-equity and strategic buyers of physician, dental, veterinary and therapy clinics. The few-site variant of the healthcare services pack.\nHow much of the clinic does the selling owner deliver, and which service lines does only the owner provide?\nDoes one referral source send most of the patients?\nHow long does the lease run after closing, and can it be renewed or assigned?\nAre costs such as supplies growing faster than revenue across the years?\nOwner-operator dependence: The selling owner’s share of visits and collections by service line, and the lines no associate covers.\nReferral concentration: Visits by referral source recomputed from the schedule export.\nThe lease as evidence: The term left after closing, the renewal option and assignment on a sale, each quoted from the lease.\nFive years of history: Visits, the commercial share and the denial rate by year, beside the P&L, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: Remittances by payer, collections by clinician, credentialing and payer contract registers (from the healthcare pack); Service lines by provider, with direct costs; Visits by referral source; Patient volume, equipment schedule and coding summary; The clinic lease, the memorandum and the P&L by year\nFindings: The selling owner as the only provider of a service line; One dominant referral source; A lease ending soon after closing with no renewal; Supplies and other costs outpacing revenue across years; Provider concentration, coding above policy and aged equipment\nValuation: DCF, with owner and referral dependence as reviewer-priced haircuts; Relocation or renegotiation risk and equipment replacement on the purchase-price bridge",
    "locale": "en"
  },
  {
    "id": "industry:hospitals",
    "kind": "INDUSTRY",
    "title": "Hospitals in Pactlab",
    "url": "https://pactlab.ai/industries/hospitals/",
    "text": "Hospital acquisitions, where the cost reports, the payer contracts, the medical staff and the plant decide what the earnings are worth.\nAcquisitions of acute-care and specialty hospitals by health systems and healthcare private equity. Extends the healthcare services pack.\nDo the filed cost reports support the occupancy and payer mix in the deck?\nWhich payer agreements end within a year of closing, and on what rate basis?\nAre the medical staff’s licences and privileges current, department by department?\nHas capex kept pace with the plant the deck describes?\nCost-report reconciliation: Occupancy and the Medicare and Medicaid shares of patient days from the filed cost reports, against the deck; total costs against the P&L.\nPlant and capex trend: Capex against revenue across every imported year, beside the facility condition assessment and what the deck claims about the plant.\nQuality claims, mapped to the reports: Published star ratings and safety grades the deck claims, checked against the reporting documents supplied.\nEvidence: Filed cost reports: beds, patient days by programme and total costs, by fiscal year; Payer mix and the payer contract register, with each agreement’s rate basis and end date; Medical-staff roster and the register of licences and clinical privileges (from the healthcare pack); Census by service line and capital expenditure by year; The deck, accreditation record, facility condition assessment, quality reports and the P&L by year\nFindings: Cost-report occupancy or payer mix contradicting the deck; A material payer agreement ending within a year of closing; A department whose physicians’ privileges lapse together; Capex falling across the P&L years against a modern-plant claim; Payer concentration, accreditation that does not transfer and key-physician dependence\nValuation: Payer-mix-adjusted EBITDA; Committed regulatory capex and deferred plant work as remediation on the purchase-price bridge",
    "locale": "en"
  },
  {
    "id": "industry:venture-raise",
    "kind": "INDUSTRY",
    "title": "Venture Raise in Pactlab",
    "url": "https://pactlab.ai/industries/venture-raise/",
    "text": "Founder-side diligence: walk into a raise knowing what investors will find, with every competing offer modelled.\nPre-seed, seed and Series A rounds from angels, incubators and accelerators, and venture funds — seen from the founder’s seat.\nWill the deck metrics survive the investor’s billing check?\nDoes the cap table reconcile to the corporate record?\nHow much do the SAFEs and the pool shuffle really dilute the founders?\nDoes the company own the IP its contractors built?\nWhich offer leaves the founders with what, and on what terms?\nA claims register for the deck: Every number checked against evidence: verified, contradicted or unverified.\nRound modelling: SAFE conversion, MFN effects and the pool shuffle across priced-round scenarios.\nCompeting offers: Each investor’s terms side by side, with the founders’ ownership after each.\nAn investor view that cannot leak: Share verified numbers and the data room; your weaknesses never cross over.\nEvidence: Cap table (Carta and Pulley exports); Billing and bank records; Certificate of incorporation, bylaws and 83(b) confirmations; IP assignment and contractor agreements; SAFEs, notes and term sheets; Code and delivery history\nFindings: Deck metrics contradicted by billing; IP assignment gaps; Cap table that does not reconcile; SAFE and MFN stacking; Runway shorter than the raise assumes\nValuation: The round at your ask, adjusted by what the evidence forces; SAFE and note conversion at cap and discount; Option-pool shuffle stated in shares and percent; Competing offers side by side; confirmed value stays confidential, never a reason to ask more",
    "locale": "en"
  },
  {
    "id": "industry:music-rights",
    "kind": "INDUSTRY",
    "title": "Music rights in Pactlab",
    "url": "https://pactlab.ai/industries/music-rights/",
    "text": "A buyer acquiring music publishing or master rights: every work’s income, title and termination windows traced to statements and registrations.\nFunds, catalog acquirers and labels buying publishing and master catalogs from artists, estates, publishers or prior funds.\nDoes the seller hold title to the works that earn the money?\nDo the splits add up, and do statements pay what the split sheets say?\nHow much of the income can authors take back before the hold ends?\nIs any advance still unrecouped, or any lien undisclosed?\nA works and rights register: Every work with its identifiers, splits, chain of title and income.\nA royalty income model: Trailing income by work and source, with decay by catalog age, in decimals.\nTermination exposure: Section 203 and 304 windows from the grant dates, the exposed income quantified.\nRights documents read for you: Statements, split sheets and agreements proposed as entries with their quotes; you confirm them.\nFive years of history: Statement income by year, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: Works and rights register: titles, ISWC and ISRC codes, PRO registrations; Writer splits from split sheets and as statements pay them; Chain of title: Copyright Office registrations, assignments, licences and administration agreements; Royalty statements by work, period and income source; Advance ledgers, lien and UCC searches\nFindings: An earning work with no assignment or registration behind it; Splits that do not total 100%, or statements paying different splits; Income whose grants become terminable under §203 or §304 inside the hold; One work or writer carrying too much of the income; An unrecouped advance or a lien the deal summary leaves out; Registered works with no performance income, and missing statement periods\nValuation: A royalty multiple on trailing net income (net publisher’s share or net label share), decay-adjusted by catalog age; Termination exposure priced as its own line on the bridge; Verified growth and clean title recorded as confirmed value, never a price increase",
    "locale": "en"
  },
  {
    "id": "industry:energy-generation",
    "kind": "INDUSTRY",
    "title": "Energy generation & rights in Pactlab",
    "url": "https://pactlab.ai/industries/energy-generation/",
    "text": "A buyer acquiring power plants, energy businesses and oil & gas interests: title, production, reserves and every environmental and retirement obligation traced to its evidence.\nFunds, utilities, independent power producers and mineral buyers acquiring plants and oil & gas interests from utilities, IPPs, E&P companies and mineral owners.\nIs every environmental and retirement obligation on the seller’s schedule, at the right size?\nDoes production support the reserve report’s decline?\nHow much acreage could lapse before the hold ends?\nDo the division orders pay what the leases support?\nAn asset and interest register: Plants and interests with capacity, contracts, leases, decimals and production.\nA production and reserves model: Decline from the production history against the third-party report, in decimals.\nA liability model: Remediation, coal ash and decommissioning estimates against what the seller booked.\nReports read for you: Reserve reports and environmental reports proposed as entries with their quotes; you confirm them.\nFive years of history: Plant generation and the wells’ oil and gas by year, with how many years each figure rests on; a missing year is asked of the seller.\nEvidence: Plant register: capacity, fuel, age, capacity factor and power purchase agreements; Interest register: mineral, royalty and working interests, leases and division-order decimals; Production history for plants and wells; Third-party reserve reports, cited as the engineers state them; Title opinions, leases, permits, closure plans and decommissioning studies; The seller’s liability schedule\nFindings: Remediation or coal-ash obligations in the evidence but missing from the liability schedule; An asset-retirement obligation booked well below the decommissioning estimate; Production falling faster than the reserve report assumes; Acreage not held by production expiring inside the hold; A division-order decimal the lease royalty chain does not support; A PPA ending inside the hold, leaving merchant exposure; A break in the chain of title, and required controls missing from the capex plan\nValuation: A reserve-based DCF for the interests, from the third-party report’s categories; $/kW of capacity plus contract coverage for the plants; Unbooked remediation and the ARO shortfall priced as remediation costs and escrows; clean title and over-booked ARO recorded as confirmed value only",
    "locale": "en"
  },
  {
    "id": "industry:startup-spv",
    "kind": "INDUSTRY",
    "title": "Startup equity SPV in Pactlab",
    "url": "https://pactlab.ai/industries/startup-spv/",
    "text": "An organizer pooling investors into one vehicle for a startup’s round: the round and the vehicle’s own economics, each checked against its documents.\nAngels, syndicate leads and emerging managers raising a single-company SPV that takes one line in a seed or Series A round.\nDoes the cap table add up once the SAFEs convert?\nDo the deck’s claims hold up against billing and the bank balance?\nDo the fee and carry investors were told match the operating agreement?\nIs every investor eligible for the vehicle’s exemption?\nRound-math verification: Shares × price against the round, every SAFE and note converted with its cap, discount and MFN.\nVehicle economics: Fee load and carry recomputed from the operating agreement and checked against the summary.\nInvestor seats: Each investor seated on their own, with accreditation tracked from a specialist; never shown each other.\nA published investor view: A frozen snapshot of what you choose to share; side letters and other investors never enter it.\nEvidence: The startup’s billing, cap table and monthly cash and burn; The round summary or deck, the term sheet and the signed SAFEs and notes; The vehicle’s operating agreement and the investor summary; Side letters and the Form D filing; Each investor’s commitment and accreditation status, from a verification specialist\nFindings: A cap table that does not add up once every SAFE and note converts; Instrument terms in the signed documents that differ from the deck; A deck claim billing or the bank balance contradicts, or that nothing supports; Fee or carry in the operating agreement that differs from the investor summary; A side letter granting economics the summary does not disclose; A 506(c) investor not verified, or no Form D on file\nValuation: The round’s pre-money, recomputed from the price and the share count; The vehicle’s fee load recomputed from its operating agreement; Net-of-fees investor returns on exit paths you state, labelled as scenarios, never promises",
    "locale": "en"
  },
  {
    "id": "pricing:overview",
    "kind": "PRICING",
    "title": "Priced per deal. Unlimited users.",
    "url": "https://pactlab.ai/pricing/",
    "text": "A buyer already spends tens of thousands on a quality-of-earnings report and far more on third-party diligence. Pactlab is priced per pact, with a subscription for teams that buy often. Everyone on your team, and everyone you invite from the other side, is included.\nUnlimited users: No seat counting. Bring the whole deal team, your advisors and the reviewers.\nGuests are free: People you invite from the other side of the deal never need a plan.\nYour record stays yours: When a pact’s live period ends it becomes read-only, never deleted.\nPromo codes: Have a code from us? Enter it when you sign up for a discount or free pacts.\nPilots: Design partners run a live deal free while their pilot agreement runs.\nCurrency and tax: Prices are in US dollars before tax. UK and EU businesses account for VAT under the reverse charge.",
    "locale": "en"
  },
  {
    "id": "pricing:pact",
    "kind": "PRICING",
    "title": "The Pact plan",
    "url": "https://pactlab.ai/pricing/",
    "text": "Pact: One acquisition, start to close.\n$2,500 per pact, one-time.\nEvery module, from evidence to close\nLive for 12 months, then read-only for good\nReports, Sextant valuation and two-sided close\nPactlab in your AI assistant\nUnlimited users; counterparty guests free",
    "locale": "en"
  },
  {
    "id": "pricing:team",
    "kind": "PRICING",
    "title": "The Team plan",
    "url": "https://pactlab.ai/pricing/",
    "text": "Team: Buyers running deals every quarter.\n$1,500 a month, billed yearly ($18,000).\nAlso: $1,800 billed monthly.\n10 pacts a year\nExtra pacts $1,500 each\nExecutive report across every deal\nEverything in Pact\nUnlimited users; counterparty guests free",
    "locale": "en"
  },
  {
    "id": "pricing:venture-raise",
    "kind": "PRICING",
    "title": "The Venture Raise plan",
    "url": "https://pactlab.ai/pricing/",
    "text": "Venture Raise: Founders preparing a round.\n$99 a month.\nAlso: $990 a year; $500 per round.\nThe readiness screen is free\nSee what an investor will find, first\nCap table, SAFEs and investor views\nShare a view with nothing confidential in it",
    "locale": "en"
  },
  {
    "id": "pricing:firm",
    "kind": "PRICING",
    "title": "The Firm and Enterprise plan",
    "url": "https://pactlab.ai/pricing/",
    "text": "Firm and Enterprise: Funds, corporate development and advisors.\nPrice: talk to us.\nHigher pact volumes\nCompany single sign-on\nSell-side pacts for running a sale\nInvoice billing and priority support\nConfidential data in your AI assistant",
    "locale": "en"
  },
  {
    "id": "trust:overview",
    "kind": "TRUST",
    "title": "Built for confidential deals",
    "url": "https://pactlab.ai/trust/",
    "text": "Diligence data is among the most sensitive a company holds. Pactlab enforces its controls in the database and on the server, not in the interface.\nTenant isolation in the database: Row-level security scopes every query to one organization and the deals a person belongs to.\nTarget boundary: People from the company being acquired see only what the buyer chooses to share.\nNo source code retained: Repositories are scanned in short-lived workspaces that are destroyed afterwards.\nTamper-evident audit trail: Sensitive reads, decisions and exports are recorded in a hash-chained, append-only log.\nYour sign-in, your choice: Each organization signs in through its identity provider or with one-time email codes.\nPasskeys: Sign in with Face ID, Touch ID, Windows Hello or a security key. Nothing to type, and nothing a phishing page can reuse.\nPeople data protected: Aggregate by default; named and compensation data gated, audited and kept away from models.",
    "locale": "en"
  }
];
