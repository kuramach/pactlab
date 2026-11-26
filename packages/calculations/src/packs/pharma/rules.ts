import { D } from '../../metrics/decimal';
import { documentClauseRule, grouped, INVOICE_LINE, percent, revenueConcentrationRule } from '../common';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleProposal } from '../rule-types';
import {
  holdWindow,
  keyScientists,
  manufacturingDependence,
  OBLIGATION,
  obligationChecks,
  patentEstate,
  PHARMA_KEY_EXPENSES,
  pipelineClaims,
  productCliffs,
  PROGRAMME,
  rdBurn,
  REGISTRY_TRIAL,
  SCIENTIST,
  timelineAccelerations,
  type ClaimAspect,
  type ObligationCheck,
  type PipelineClaim,
} from './pipeline';

/**
 * Pharma and biotech pack rules (T-064, spec §19). Exclusivity, supply and
 * partner risks; clinical and regulatory judgement stays with the reviewer.
 */
const PATENT = 'pharma.patent';
const EXCLUSIVITY = /exclusivity (?:through|until|to) (?:the end of )?(\d{4})/i;

/**
 * The forecast assumes exclusivity for a product beyond its core patents: the
 * latest composition-of-matter expiry (or, without one, the latest expiry of
 * any type) falls before the year the forecast assumes.
 */
export const PHARMA_PATENT_BEFORE_FORECAST: PackRule = {
  id: 'pharma-patent-before-forecast',
  version: '1',
  evidenceTypes: [PATENT],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const patents = evidence.filter((row) => row.evidenceType === PATENT && /^\d{4}-\d{2}-\d{2}/.test(row.canonical['expiry'] ?? ''));
    const products = [...new Set(patents.map((row) => row.canonical['product'] ?? ''))].filter(Boolean);
    const proposals = [];
    for (const product of products) {
      const hit = findSentence(pages, (sentence) => sentence.includes(product) && EXCLUSIVITY.test(sentence));
      if (!hit) continue;
      const assumed = EXCLUSIVITY.exec(hit.quote)?.[1] ?? '';
      const own = patents.filter((row) => row.canonical['product'] === product);
      const core = own.filter((row) => /composition/i.test(row.canonical['type'] ?? ''));
      const basis = core.length > 0 ? core : own;
      const expiry = basis.map((row) => row.canonical['expiry'] ?? '').sort().at(-1) ?? '';
      if (!expiry || expiry.slice(0, 4) >= assumed) continue;
      const later = own.filter((row) => !basis.includes(row) && (row.canonical['expiry'] ?? '') > expiry);
      proposals.push({
        key: `${product}:${assumed}`,
        domain: 'LEGAL' as const,
        title: 'Key patent expires earlier than the forecast assumes',
        description:
          `The forecast assumes ${product} exclusivity through ${assumed}; its ${core.length > 0 ? 'composition-of-matter' : 'listed'} patents expire by ${expiry} (${basis.map((row) => `${row.canonical['family']} ${row.canonical['jurisdiction']} ${row.canonical['expiry']}`).join('; ')}).` +
          (later.length > 0 ? ` Later ${[...new Set(later.map((row) => row.canonical['type']))].join(' and ')} patents give narrower protection.` : ''),
        severity: 'HIGH' as const,
        confidence: 'HIGH' as const,
        direction: -1 as const,
        directionRationale: 'Revenue after core patent expiry faces generic entry; the exclusivity scenario and price follow, priced by the reviewer.',
        evidenceIds: basis.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }],
      });
    }
    return proposals;
  },
};

export const PHARMA_SUPPLIER_OBSERVATIONS = documentClauseRule({
  id: 'pharma-supplier-observations',
  title: 'Open manufacturing observations at the supplier',
  domain: 'REGULATORY',
  severity: 'HIGH',
  direction: 0,
  directionRationale: 'Corrective-action close-out as a closing deliverable or a supply covenant, not a price term.',
  sentences: [(sentence) => /open observations?:?\s*[1-9]/i.test(sentence)],
  description: ([observations]) => `The contract manufacturer's latest inspection leaves observations open: “${observations}”`,
});

/** The largest partner across its revenue lines ("<Partner> — <line>"). */
export const PHARMA_PARTNER_CONCENTRATION = revenueConcentrationRule({
  id: 'pharma-partner-concentration',
  title: 'Partner concentration',
  domain: 'COMMERCIAL',
  threshold: '0.4',
  groupBy: { key: (name) => /^(.+?) — /.exec(name)?.[1] ?? name.replace(/\s*\([^)]*\)\s*$/, ''), label: (partner) => partner },
  direction: 0,
  directionRationale: 'A partner-renewal or royalty-term sensitivity in the scenarios, not a price term.',
  consequence: 'A dispute or a renegotiation with that partner moves most of the revenue.',
});

// ------------------------------------------------------------------ T-163: checked against documents

const ASPECT_WORD: Readonly<Record<ClaimAspect, string>> = { PHASE: 'phase', TIMELINE: 'timeline', STATUS: 'status' };
type Decimal = InstanceType<typeof D>;
const money = (currency: string | null, amount: Decimal) => `${currency ? `${currency} ` : ''}${grouped(amount)}`;

function claimProposal(claim: PipelineClaim): PackRuleProposal {
  const label = `${claim.programme} ${ASPECT_WORD[claim.aspect]}`;
  const base = {
    key: `${claim.programme}:${claim.aspect.toLowerCase()}:${claim.status.toLowerCase()}`,
    domain: 'REGULATORY' as const,
    confidence: 'HIGH' as const,
    evidenceIds: [...new Set(claim.evidenceIds)].slice(0, MAX_CITED),
    quotes: claim.quotes,
    claim: { statement: claim.statement, status: claim.status, rationale: claim.rationale },
  };
  if (claim.status === 'UNVERIFIED')
    return {
      ...base,
      title: `Claim not verified: ${label}`,
      description: `The pipeline schedule says ${claim.statement}. ${claim.rationale} Ask the seller for the registry record or the regulator's correspondence before relying on it.`,
      severity: 'MEDIUM',
      direction: 0,
      directionRationale: 'A gap, not a defect: an unverified claim is neither priced nor relied on.',
    };
  if (claim.status === 'VERIFIED')
    return {
      ...base,
      title: `Claim verified: ${label}`,
      description: `The pipeline schedule says ${claim.statement}. ${claim.rationale}`,
      severity: 'LOW',
      direction: 1,
      valueConfirmation: { valueDriver: `${label} verified against the registry records and correspondence`, impliedValue: null, basis: claim.rationale },
    };
  return {
    ...base,
    title: `Claim contradicted: ${label}`,
    description: `The pipeline schedule says ${claim.statement}. ${claim.rationale} The evidence supplied does not support the claim; Pactlab reports the inconsistency and makes no judgment on the programme itself.`,
    severity: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'The price rests on a development stage or timeline the filings do not support; price it as a later, slower case in the scenarios.',
  };
}

/** Each programme's phase, timeline and status claim against the registry records and the correspondence supplied. */
export const PHARMA_PIPELINE_CLAIMS: PackRule = {
  id: 'pharma-pipeline-claims',
  version: '1',
  evidenceTypes: [PROGRAMME, REGISTRY_TRIAL],
  readsDocuments: true,
  // The correspondence may settle a claim the registry does not: until any document has been read (an import before the data room), wait for them.
  detect: ({ evidence, pages }) => (pages.length === 0 ? [] : pipelineClaims(evidence, pages).map(claimProposal)),
};

/**
 * A product's patent protection ending inside the hold: the first jurisdiction where its composition-of-matter
 * patents (else all its patents) run out, a patent record's expiry governing the schedule's. Priced on the
 * product's billed revenue: low one year of it, high a year for each year of the hold left after the cliff.
 */
export const PHARMA_PATENT_CLIFF: PackRule = {
  id: 'pharma-patent-cliff',
  version: '1',
  evidenceTypes: [PATENT, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    // Patent records govern the dates and the documents state the closing and the hold: until any has been read, wait for them.
    if (pages.length === 0) return [];
    const hold = holdWindow(evidence, pages);
    if (!hold) return [];
    return productCliffs(patentEstate(evidence, pages), hold, evidence).flatMap((cliff): PackRuleProposal[] => {
      if (cliff.state !== 'IN_HOLD' || !cliff.cliff || cliff.monthsAfterClosing === null || !cliff.yearsOfHoldAfter) return [];
      const from = hold.basis === 'EXPECTED_CLOSING' ? 'closing' : 'the analysis date';
      const revenue = cliff.revenue;
      const priced = revenue && revenue.currency && revenue.annual.gt(0);
      const high = priced ? revenue.annual.times(cliff.yearsOfHoldAfter).toDecimalPlaces(2) : null;
      const low = priced && high ? (revenue.annual.lt(high) ? revenue.annual : high) : null;
      const rows = cliff.basis.map((entry) => `${entry.family} ${entry.jurisdiction} ${entry.type} ${entry.expiry ?? 'no date'}${entry.basis === 'DOCUMENT' ? ' (patent record)' : ''}`).join('; ');
      return [
        {
          key: `${cliff.product}:cliff:${cliff.cliff}`,
          domain: 'LEGAL',
          title: `Key patent expires ${cliff.monthsAfterClosing} months after ${from}: ${cliff.product}`,
          description:
            `${cliff.product}'s ${cliff.coreBasis ? 'composition-of-matter' : 'listed'} protection first ends in ${cliff.jurisdiction} on ${cliff.cliff}, ${cliff.monthsAfterClosing} months after ${from} (${hold.from}) and inside the ${hold.years}-year hold to ${hold.to}${hold.yearsStated ? ' the documents state' : ' Pactlab assumes when no document states one'}: ${rows}. ` +
            (priced && revenue
              ? `The billing lines naming ${cliff.product} come to ${money(revenue.currency, revenue.annual)} for ${revenue.from} to ${revenue.to}; ${cliff.yearsOfHoldAfter.toFixed(2)} years of the hold remain after the cliff. Priced as revenue at risk, before any erosion assumption the reviewer sets.`
              : `No billing line names ${cliff.product}, so the revenue at risk is for the reviewer to price.`),
          severity: cliff.monthsAfterClosing <= 24 ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'Revenue after the cliff faces generic or biosimilar entry inside the hold; the bridge carries it as a price reduction the reviewer can narrow.',
          pricedRisk:
            priced && revenue && low && high
              ? {
                  type: 'PRICE_REDUCTION',
                  currency: revenue.currency ?? '',
                  low: low.toFixed(2),
                  high: high.toFixed(2),
                  basis: `Trailing twelve months of ${cliff.product} revenue (${money(revenue.currency, revenue.annual)}): low one year of it, high ${cliff.yearsOfHoldAfter.toFixed(2)} years — the hold left after ${cliff.cliff}.`,
                }
              : null,
          evidenceIds: [...cliff.basis.map((entry) => entry.evidenceId), ...(revenue?.evidenceIds ?? [])].slice(0, MAX_CITED),
          quotes: [...cliff.basis.flatMap((entry) => (entry.quote ? [entry.quote] : [])), ...(hold.closingQuote ? [hold.closingQuote] : [])],
        },
      ];
    });
  },
};

const OBLIGATION_TITLE = { milestone: 'Milestone payment', royalty: 'Royalty', licence_fee: 'Annual licence fee' } as const;

function obligationProposal(check: ObligationCheck): PackRuleProposal | null {
  const { obligation } = check;
  if (check.state === 'IN_MODEL') return null;
  const payee = obligation.payee.replace(/^(?:the )/i, '');
  const what = obligation.kind === 'milestone' ? `${OBLIGATION_TITLE.milestone} of ${money(obligation.currency, obligation.amount ?? new D(0))} on ${obligation.trigger}` : obligation.kind === 'royalty' ? `${OBLIGATION_TITLE.royalty} of ${percent(obligation.rate ?? new D(0))} on ${obligation.trigger ?? 'net sales'}` : `${OBLIGATION_TITLE.licence_fee} of ${money(obligation.currency, obligation.amount ?? new D(0))}`;
  const when = check.expected ? ` The pipeline schedule expects ${check.expected.programme}'s ${check.expected.milestone} in ${check.expected.expected}.` : '';
  const evidenceIds = [...(check.model ? [check.model.evidenceId] : []), ...(check.expected ? [check.expected.evidenceId] : [])];
  const keyed = `${normalizeKey(payee)}:${obligation.kind}:${(obligation.trigger ?? '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
  if (check.state === 'OMITTED') {
    const priced = obligation.amount && obligation.currency;
    return {
      key: `${keyed}:omitted`,
      domain: 'LEGAL',
      title: `${OBLIGATION_TITLE[obligation.kind]} omitted from the seller's model: ${payee}`,
      description: `The agreement obliges the company to pay ${payee}: ${what}. The seller's obligations model has no ${obligation.kind.replace('_', ' ')} line for ${payee}${obligation.kind === 'milestone' ? ' on that event' : ''}.${when}`,
      severity: 'HIGH',
      confidence: 'HIGH',
      direction: -1,
      directionRationale: 'A payment the agreement requires and the model leaves out; the bridge carries it as the amount the agreement states.',
      pricedRisk:
        priced && obligation.amount && obligation.currency
          ? {
              type: 'PRICE_REDUCTION',
              currency: obligation.currency,
              low: obligation.amount.toFixed(2),
              high: (obligation.kind === 'licence_fee' ? obligation.amount.times(PHARMA_DEFAULT_FEE_YEARS) : obligation.amount).toFixed(2),
              basis: obligation.kind === 'licence_fee' ? `The annual fee the agreement states: low one year, high ${PHARMA_DEFAULT_FEE_YEARS} years.` : 'The milestone as the agreement states it, due on its event.',
            }
          : null,
      evidenceIds,
      quotes: [obligation.quote],
    };
  }
  if (check.state === 'UNDERSTATED' && check.gap && obligation.currency)
    return {
      key: `${keyed}:understated`,
      domain: 'LEGAL',
      title: `${OBLIGATION_TITLE[obligation.kind]} understated in the seller's model: ${payee}`,
      description: `The agreement states ${what}; the seller's model (${check.model?.obligationId}) carries ${money(obligation.currency, check.model?.amount ?? new D(0))}, ${money(obligation.currency, check.gap)} less.${when}`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: -1,
      directionRationale: 'The model carries less than the agreement requires; the bridge carries the difference.',
      pricedRisk: { type: 'PRICE_REDUCTION', currency: obligation.currency, low: check.gap.toFixed(2), high: check.gap.toFixed(2), basis: "The agreement's amount less the model's." },
      evidenceIds,
      quotes: [obligation.quote],
    };
  if (check.state === 'RATE_UNDERSTATED')
    return {
      key: `${keyed}:rate`,
      domain: 'LEGAL',
      title: `Royalty rate understated in the seller's model: ${payee}`,
      description: `The agreement states ${what}; the seller's model (${check.model?.obligationId}) carries ${percent(check.model?.rate ?? new D(0))}.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: -1,
      pricedRisk: null,
      directionRationale: 'Royalties on future sales run at the agreement\'s rate; price it as a margin haircut in the scenarios.',
      evidenceIds,
      quotes: [obligation.quote],
    };
  return null;
}
const normalizeKey = (value: string) => value.toLowerCase().replaceAll(/\(synthetic\)/g, '').replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
/** Years of an omitted annual licence fee the high end prices (the default hold). */
export const PHARMA_DEFAULT_FEE_YEARS = 5;

/** Milestones, royalties and licence fees the agreements state, recomputed and looked for in the seller's model. */
export const PHARMA_OBLIGATIONS: PackRule = {
  id: 'pharma-obligations',
  version: '1',
  evidenceTypes: [OBLIGATION, PROGRAMME],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    // Without the seller's model there is nothing to check the agreements against; the Pipeline page shows its absence.
    if (!evidence.some((row) => row.evidenceType === OBLIGATION)) return [];
    return obligationChecks(evidence, pages).checks.flatMap((check) => obligationProposal(check) ?? []);
  },
};

/** A product one manufacturer or supplier makes, with no second source the documents describe. */
export const PHARMA_MANUFACTURING_DEPENDENCE: PackRule = {
  id: 'pharma-manufacturing-dependence',
  version: '1',
  evidenceTypes: [PATENT, PROGRAMME],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const products = [...evidence.filter((row) => row.evidenceType === PATENT).map((row) => row.canonical['product'] ?? ''), ...evidence.filter((row) => row.evidenceType === PROGRAMME).map((row) => row.canonical['programme'] ?? '')];
    return manufacturingDependence(pages, products).flatMap((entry): PackRuleProposal[] =>
      entry.singleSource
        ? [
            {
              key: `${entry.product}:single-source`,
              domain: 'OPERATIONAL',
              title: `Single-source manufacturing: ${entry.product}`,
              description: `“${entry.sole.quote}”${entry.secondSource ? ` The same document: “${entry.secondSource.quote.quote}”` : ' No second source is described in the documents.'} A supply interruption at that manufacturer stops the product.`,
              severity: 'MEDIUM',
              confidence: 'HIGH',
              direction: 0,
              directionRationale: 'A supply-continuity covenant or the qualification of a second source as a closing or post-close deliverable, not a price term.',
              evidenceIds: [],
              quotes: [entry.sole, ...(entry.secondSource ? [entry.secondSource.quote] : [])],
            },
          ]
        : [],
    );
  },
};

/** A scientist (by pseudonymous reference) leading half the programmes or named on half the patent families, with no retention agreement on file. */
export const PHARMA_KEY_SCIENTIST: PackRule = {
  id: 'pharma-key-scientist',
  version: '1',
  evidenceTypes: [SCIENTIST, PROGRAMME, PATENT],
  readsDocuments: true,
  detect: ({ evidence, pages }) =>
    // A retention agreement on file clears the finding: until any document has been read, wait for them.
    (pages.length === 0 ? [] : keyScientists(evidence, pages)).flatMap((entry): PackRuleProposal[] => {
      if (!entry.concentrated || entry.retention) return [];
      const shares = [
        entry.programmeShare ? `leads ${entry.programmesLed.toFixed(0)} of the pipeline's programmes (${percent(entry.programmeShare)})` : null,
        entry.familyShare ? `is a named inventor on ${entry.patentFamilies.toFixed(0)} of the patent families (${percent(entry.familyShare)})` : null,
      ].filter(Boolean);
      return [
        {
          key: `${entry.scientistRef}:key-scientist`,
          domain: 'PEOPLE',
          title: `Key-scientist concentration: ${entry.scientistRef}`,
          description: `${entry.scientistRef} (${entry.function}) ${shares.join(' and ')}, from the R&D roster. No document names ${entry.scientistRef} with a retention, employment, consulting or non-compete agreement. A retention risk for the programmes and the estate, never a ranking of the person.`,
          severity: 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          directionRationale: 'The programmes and the patent estate depend on one person with no retention on file; a retention arrangement or holdback the reviewer prices.',
          evidenceIds: [entry.evidenceId],
          quotes: [],
        },
      ];
    }),
};

/** R&D spend flat across the imported P&L years while a document says the development timeline was brought forward. */
export const PHARMA_BURN_VS_TIMELINE: PackRule = {
  id: 'pharma-burn-vs-timeline',
  version: '1',
  evidenceTypes: [PNL_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const burn = rdBurn(evidence);
    const faster = timelineAccelerations(pages);
    const first = burn.years[0];
    const last = burn.years.at(-1);
    if (!burn.flat || !first || !last || faster.length === 0 || burn.change === null) return [];
    return [
      {
        key: `rd-flat:${first.year}-${last.year}`,
        domain: 'FINANCIAL',
        title: `R&D spend flat while the timeline is brought forward, ${first.year}–${last.year}`,
        description:
          `Research and development is ${burn.years.map((year) => `${grouped(year.amount)} in ${year.year}`).join(', ')} in the imported P&L — ${burn.change.gte(0) ? '+' : ''}${percent(burn.change)} from first year to last — while ${faster.length === 1 ? 'a document says' : 'the documents say'} the development timeline was brought forward (${faster.map((entry) => `“${entry.quote.quote}”`).join(' ')}). ` +
          'A faster timeline on the same spend is not supported by the P&L; a single year cannot show it. Ask for the budget behind the new dates.',
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Either the timeline slips back or the spend rises; price it in the scenarios as the later dates or the extra R&D.',
        evidenceIds: [...new Set(burn.years.flatMap((year) => year.evidenceIds))].slice(0, MAX_CITED),
        quotes: faster.map((entry) => entry.quote),
      },
    ];
  },
};

/** The multi-year P&L trend (Kumar, 2026-11-26): R&D, manufacturing and supply, and royalties paid against revenue. */
export const [PHARMA_PNL_TREND, PHARMA_PNL_MARGIN_DRIFT, PHARMA_PNL_EXPENSE_OUTPACING] = pnlTrendRules('pharma', PHARMA_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

export const PHARMA_RULES: readonly PackRule[] = [
  PHARMA_PATENT_BEFORE_FORECAST,
  PHARMA_SUPPLIER_OBSERVATIONS,
  PHARMA_PARTNER_CONCENTRATION,
  PHARMA_PIPELINE_CLAIMS,
  PHARMA_PATENT_CLIFF,
  PHARMA_OBLIGATIONS,
  PHARMA_MANUFACTURING_DEPENDENCE,
  PHARMA_KEY_SCIENTIST,
  PHARMA_BURN_VS_TIMELINE,
  PHARMA_PNL_TREND,
  PHARMA_PNL_MARGIN_DRIFT,
  PHARMA_PNL_EXPENSE_OUTPACING,
];
export const PHARMA_EVIDENCE = { PATENT, PROGRAMME, REGISTRY_TRIAL, OBLIGATION, SCIENTIST } as const;
