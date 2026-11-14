/**
 * The guided tour and "Why this matters" callouts (Kumar, 2026-11-13): context on each part of a
 * pact, so a demo sells itself and a new customer learns the loop. Plain copy, no figures Pactlab
 * cannot back. Shown to everyone; each person can hide it (Settings, or "Hide guide").
 */
export interface ShowcaseEntry {
  /** What this part is, in a line. */
  readonly title: string;
  /** Why a deal team cares: the job it replaces and the decision it supports. */
  readonly why: string;
  /** What to point at on the screen. */
  readonly lookFor: readonly string[];
}

/** One entry per deal section path (`DEAL_SECTION_RULES`); a test keeps them in step. */
export const SHOWCASE: Readonly<Record<string, ShowcaseEntry>> = {
  '': {
    title: 'The whole deal on one page',
    why: 'Where the pact stands, what is still open and what the evidence says so far: the page a partner opens before the investment committee.',
    lookFor: ['The phase: Pre-Diligence, Diligence or Post-Close', 'Open findings and their priced impact', 'The asking price next to Sextant’s view'],
  },
  '/bidders': {
    title: 'A sale run like a process, not an inbox',
    why: 'Every bidder sees only their own bid, questions and answers. The seller compares offers side by side, shortlists and awards without a spreadsheet of emails.',
    lookFor: ['Each bidder’s NDA, questions and offer', 'Answers sent to everyone without naming who asked', 'Shortlist and award, recorded'],
  },
  '/listing': {
    title: 'An anonymous teaser that finds buyers',
    why: 'Publish the opportunity without naming the company, with property facts filled in for you, and let interested buyers come to the process.',
    lookFor: ['The anonymous public page', 'Property facts looked up from the address', 'Asking range and highlights'],
  },
  '/screening': {
    title: 'Go or no-go before spending on diligence',
    why: 'A quick, recorded screen from the teaser and headline figures. Red flags carry forward as questions diligence must answer, so nothing raised early is lost.',
    lookFor: ['Headline figures against the asking range', 'Red flags that became seller statements to test', 'The verdict, who made it and why'],
  },
  '/team': {
    title: 'The right people, and only them',
    why: 'The deal team, reviewers and the seller’s contributors each see what their role allows. The seller never sees your pricing or your notes.',
    lookFor: ['Roles on the pact', 'The seller as a guest, limited to what you share', 'Invitations with an audit trail'],
  },
  '/documents': {
    title: 'The data room, read and filed for you',
    why: 'Drop in the data room as one zip. Pactlab reads each file, files it as what it is, and only asks a person when it is unsure: no hours of labelling.',
    lookFor: ['Files sorted into contracts, financials and extracts', 'Questions only where the AI was unsure', 'Exact citations behind every extracted term'],
  },
  '/findings': {
    title: 'Every risk, evidenced, priced and decided by a person',
    why: 'Rules, scans and AI draft findings; your team submits them and a second person decides. Each accepted risk carries its price range into valuation.',
    lookFor: ['Drags (price down) and value confirmed (kept confidential)', 'A finding accepted, one sent back for support, one rejected', 'Every finding linked to the evidence behind it'],
  },
  '/sources': {
    title: 'The systems behind the numbers',
    why: 'Billing, code and delivery connect once and stay in sync, so metrics are rebuilt from records, not from the management deck.',
    lookFor: ['Connected sources and their last sync', 'Imported extracts with every row validated', 'Nothing changed at the source without a new sync'],
  },
  '/evidence': {
    title: 'Every number traces to a record',
    why: 'The evidence behind each metric and finding, with where it came from. When someone asks “says who?”, the answer is one click away.',
    lookFor: ['Records with their source and sync run', 'Links from evidence to the findings it supports'],
  },
  '/finances': {
    title: 'Cash, debt and what sits in between',
    why: 'Balance-sheet items cited to the page they came from, feeding the bridge from enterprise value to the price you actually pay.',
    lookFor: ['Cash, a term loan and debt-like items', 'Each item cited to its source page', 'Loan terms on the debt'],
  },
  '/engineering': {
    title: 'The codebase and team, read from the repository',
    why: 'Commit history and delivery data show who really built the product and whether the team can ship the plan. Source code is never kept.',
    lookFor: ['Key-person concentration, as aggregates', 'Delivery against commitment, sprint by sprint', 'Every technical finding tied to a commit'],
  },
  '/regulatory': {
    title: 'Deal certainty, not just deal value',
    why: 'Clearance terms, the regulator’s posture and the commitments in the agreement, each cited, so the team knows the risk of the deal not closing.',
    lookFor: ['Efforts standard, divestiture cap and termination fee', 'The enforcement climate, dated and cited', 'Commitments the buyer would make'],
  },
  '/claims': {
    title: 'What was said, against what was found',
    why: 'Every seller statement is tracked as verified, contradicted or still open, linked to the findings that settled it. Credibility, made visible.',
    lookFor: ['A statement contradicted by billing data', 'A statement verified from the data room', 'One still waiting for evidence'],
  },
  '/raise': {
    title: 'A founder’s view of the round',
    why: 'Competing offers modelled side by side: dilution, preferences and terms explained as consequences, plus a clean view to share with investors.',
    lookFor: ['Three offers compared', 'The round model for each', 'The investor view: verified facts only'],
  },
  '/valuation': {
    title: 'Sextant: what to pay, and why',
    why: 'Scenarios from stored inputs, accepted risks priced in, comparables and negotiation anchors: a price you can defend line by line.',
    lookFor: ['Downside, base and upside, moved by priced risks', 'The bridge from enterprise value to equity price', 'Comparables, anchors and the judgement of the ask'],
  },
  '/foresight': {
    title: 'Where the business is heading',
    why: 'Forecasts of the metrics that matter, with your own view alongside, so the price reflects the next years, not just the last one.',
    lookFor: ['Metric forecasts with ranges', 'Your forecast next to the baseline', 'Scenarios that move the outlook'],
  },
  '/terms': {
    title: 'Terms tied to the risks that justify them',
    why: 'The price and each escrow or indemnity proposed, countered and agreed in one place, each term traceable to the finding behind it.',
    lookFor: ['The seller’s counter on the headline price', 'The revised version, accepted', 'Terms linked to findings'],
  },
  '/ic': {
    title: 'The committee decides, on the record',
    why: 'The deal team submits a versioned pack; the investment committee approves, declines or sets conditions, and signing can wait for it. The seller never sees any of it.',
    lookFor: ['The IC pack: what is asked, the largest risks, open blockers', 'The decision, who made it and why', 'Conditions the team works off before signing'],
  },
  '/loi': {
    title: 'Intent agreed, exclusivity secured',
    why: 'A letter of intent written from the agreed terms: the economics as non-binding intent, exclusivity and confidentiality binding, signed by both sides.',
    lookFor: ['Non-binding and binding provisions side by side', 'The agreed price quoted exactly', 'Exclusivity days left after countersignature'],
  },
  '/closing': {
    title: 'Both sides sign, funds are confirmed',
    why: 'Named signatories sign the agreed version, the closing checklist is worked by both sides, and the seller confirms the funds arrived.',
    lookFor: ['Both sign-offs on the agreed version', 'The closing checklist, ticked by both sides', 'Funds recorded by the buyer, confirmed by the seller'],
  },
  '/post-close': {
    title: 'Protect what you paid for',
    why: 'Diligence becomes the first 100 days: the assets behind the value, the risks to watch and the claims windows, each with an owner and a date.',
    lookFor: ['Preservation actions with owners and due dates', 'One already done', 'Escrow and indemnity watch items'],
  },
};

/** The tour: the story of a pact, in order. Sections a pact does not show are skipped. */
export const TOUR_PATHS: readonly string[] = [
  '',
  '/screening',
  '/documents',
  '/findings',
  '/claims',
  '/engineering',
  '/finances',
  '/regulatory',
  '/valuation',
  '/raise',
  '/terms',
  '/loi',
  '/ic',
  '/closing',
  '/post-close',
  '/bidders',
];

/** The guide preference: on unless the person hid it on this browser. */
export const GUIDE_COOKIE = 'pactlab_guide';
