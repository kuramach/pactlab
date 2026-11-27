import { D } from '../../metrics/decimal';
import { ENERGY_GENERATION_TREND } from './history';
import { grouped, moneyIn, percent } from '../common';
import { collapse, MAX_CITED, sentences, type PackRule, type PackRulePage, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  analysisDate,
  assumedDecline,
  decimalChecks,
  ENERGY_ENTRY,
  ENERGY_EVIDENCE_TYPES,
  ENERGY_THRESHOLDS,
  energyHoldYears,
  energyRows,
  leaseExposure,
  liabilityModel,
  monthsBetween,
  ppaCliffs,
  productionModel,
  reserveReportOnFile,
  type LiabilityLine,
} from './assets';

/**
 * Energy generation & rights rules (T-142, ADR 0043). Deterministic, decimal-only and cited; every
 * proposal is a DRAFT a named reviewer decides. Diligence support only: no rule determines title,
 * certifies reserves or gives engineering or regulatory advice — each flags a gap in the evidence.
 */
type Decimal = InstanceType<typeof D>;
const money = (value: Decimal) => grouped(value);
const points = (value: Decimal) => value.times(100).toFixed(1).replace(/\.0$/, '');
const cited = (ids: readonly string[]) => [...new Set(ids)].slice(0, MAX_CITED);
/** Rules read every imported type plus the entries a person confirmed. */
const READS = [...ENERGY_EVIDENCE_TYPES, ...Object.values(ENERGY_ENTRY)];
const LABELS: Readonly<Record<string, string>> = { remediation: 'Environmental remediation', ccr: 'Coal ash (CCR) closure', reclamation: 'Site reclamation', aro: 'Asset retirement obligation' };
const where = (line: LiabilityLine) => line.assetName ?? 'the portfolio';
const amountOf = (line: LiabilityLine, value: Decimal) => (line.currency ? `${line.currency} ${money(value)}` : money(value));

/** Remediation, coal-ash or reclamation obligations the evidence states but the seller's liability schedule does not hold. */
export const ENERGY_UNBOOKED_ENVIRONMENTAL: PackRule = {
  id: 'energy-unbooked-environmental',
  version: '1',
  evidenceTypes: READS,
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = energyRows(evidence);
    if (rows.liabilities.length === 0 && rows.plants.length === 0 && rows.interests.length === 0) return [];
    return liabilityModel(rows, pages)
      .lines.filter((line) => line.kind !== 'aro' && line.status === 'UNBOOKED')
      .map((line): PackRuleProposal => ({
        key: `${line.kind}:${line.assetId ?? 'portfolio'}`,
        domain: 'REGULATORY',
        title: `Unbooked environmental liability: ${LABELS[line.kind] ?? line.kind} at ${where(line)}`,
        description: `The evidence estimates ${LABELS[line.kind]?.toLowerCase() ?? line.kind} at ${where(line)} at ${amountOf(line, line.estimate)}, and the seller's liability schedule books nothing for it (${rows.liabilities.length} schedule line${rows.liabilities.length === 1 ? '' : 's'} read). Quantified at the evidence's own estimate; Pactlab does not estimate it. A remediation-cost reduction or an escrow until closure, for the reviewer to price.`,
        severity: 'HIGH',
        confidence: line.quotes.length || line.estimateIds.length ? 'HIGH' : 'MEDIUM',
        direction: -1,
        directionRationale: 'An obligation the buyer inherits that the seller has not booked: a remediation cost off the price, or an escrow until the work is done.',
        pricedRisk: line.currency ? { type: 'REMEDIATION_COST', currency: line.currency, low: line.estimate.toFixed(2), high: line.estimate.toFixed(2), basis: 'The estimate the report or permit states, unbooked on the seller’s liability schedule.' } : null,
        evidenceIds: cited([...line.estimateIds, ...rows.plants.filter((plant) => plant.id === line.assetId).map((plant) => plant.evidenceId), ...rows.liabilities.map((booked) => booked.id)]),
        quotes: line.quotes,
      }));
  },
};

/** The evidence-based decommissioning estimate exceeds the booked asset-retirement obligation by a material margin. */
export const ENERGY_ARO_SHORTFALL: PackRule = {
  id: 'energy-aro-shortfall',
  version: '1',
  evidenceTypes: READS,
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = energyRows(evidence);
    return liabilityModel(rows, pages)
      .lines.filter((line) => line.kind === 'aro' && line.status !== 'COVERED')
      .map((line): PackRuleProposal => {
        const funded = line.estimate.gt(0) ? line.booked.div(line.estimate) : new D(0);
        return {
          key: `aro:${line.assetId ?? 'portfolio'}`,
          domain: 'FINANCIAL',
          title: `ARO shortfall: ${where(line)}`,
          description: `The evidence estimates retirement and decommissioning at ${where(line)} at ${amountOf(line, line.estimate)}; the seller books ${amountOf(line, line.booked)} for it (${percent(funded)} of the estimate), ${amountOf(line, line.gap)} short — above the ${percent(new D(ENERGY_THRESHOLDS.aroMargin))} margin the pack flags. The estimate is the study's, not Pactlab's.`,
          severity: line.gap.gte(line.estimate.times('0.25')) ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'An under-booked retirement obligation the buyer funds: an escrow sized at the shortfall.',
          pricedRisk: line.currency ? { type: 'ESCROW', currency: line.currency, low: line.gap.toFixed(2), high: line.gap.toFixed(2), basis: 'The evidence-based decommissioning estimate less the seller’s booked asset-retirement obligation.' } : null,
          evidenceIds: cited([...line.estimateIds, ...line.bookedIds]),
          quotes: line.quotes,
        };
      });
  },
};

/** Actual production decline is materially steeper than the decline the reserve report assumes. */
export const ENERGY_DECLINE_MISMATCH: PackRule = {
  id: 'energy-decline-mismatch',
  version: '1',
  evidenceTypes: READS,
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = energyRows(evidence);
    const production = productionModel(rows);
    const assumed = assumedDecline(rows, pages);
    if (!assumed || !production.interestDecline) return [];
    const limit = assumed.percent.plus(ENERGY_THRESHOLDS.declinePoints).div(100);
    if (production.interestDecline.lte(limit)) return [];
    const steeper = rows.interests.filter((interest) => {
      const decline = production.byAsset.get(interest.id)?.decline;
      return decline !== null && decline !== undefined && decline.gt(limit);
    });
    return [
      {
        key: `${production.analysisDate}`,
        domain: 'OPERATIONAL',
        title: 'Decline mismatch: production falling faster than the reserve report assumes',
        description: `Production on the interests fell ${points(production.interestDecline)}% in the twelve months to ${production.analysisDate} (BOE, against the year before), against the ${assumed.percent.toFixed(1).replace(/\.0$/, '')}% annual decline the reserve report assumes — more than ${ENERGY_THRESHOLDS.declinePoints} points steeper. Steeper than that on ${steeper.length} interest${steeper.length === 1 ? '' : 's'}: ${steeper.slice(0, 10).map((interest) => `${interest.name} (${interest.id})`).join('; ')}. The report's reserves rest on its own assumption; its engineers should be asked to reconcile.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Reserves and cash flows from a slower decline than the history shows: a drag on the affected interests, for the reviewer to price.',
        evidenceIds: cited([...(assumed.evidenceId ? [assumed.evidenceId] : []), ...steeper.map((interest) => interest.evidenceId), ...steeper.flatMap((interest) => production.byAsset.get(interest.id)?.lineIds.slice(0, 2) ?? [])]),
        quotes: assumed.quote ? [assumed.quote] : [],
      },
    ];
  },
};

/** Material net acreage not held by production whose primary term ends inside the hold period. */
export const ENERGY_LEASE_EXPIRY: PackRule = {
  id: 'energy-lease-expiry',
  version: '1',
  evidenceTypes: READS,
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = energyRows(evidence);
    const date = analysisDate(rows);
    const hold = energyHoldYears(pages);
    const exposure = leaseExposure(rows, date, hold.years);
    if (!exposure.share || exposure.share.lt(ENERGY_THRESHOLDS.leaseExposedShare) || !date) return [];
    const last = exposure.leases.at(-1)?.expiresOn ?? date;
    const first = exposure.leases[0]?.expiresOn ?? date;
    return [
      {
        key: `${date}:${hold.years}`,
        domain: 'LEGAL',
        title: 'Lease expiry risk: acreage not held by production',
        description: `${exposure.leases.length} lease${exposure.leases.length === 1 ? '' : 's'} covering ${percent(exposure.share)} of the net acres (${exposure.exposedAcres.toFixed(2).replace(/\.00$/, '')} of ${exposure.totalAcres.toFixed(2).replace(/\.00$/, '')}) are not held by production and their primary terms end between ${first} and ${last} — within ${monthsBetween(date, last)} months of ${date}, inside the ${hold.years}-year hold${hold.stated ? '' : ' (the pack’s default hold; a stated hold period on any document replaces it)'}. Without drilling, extensions or a unit, that acreage lapses. Whether a lease is in fact held is for counsel.`,
        severity: exposure.share.gte('0.2') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Acreage the buyer may lose during the hold: a drag on the exposed share, for the reviewer to price.',
        evidenceIds: cited(exposure.leases.map((lease) => lease.evidenceId)),
      },
    ];
  },
};

/** A division-order decimal differs from the NRI recomputed from the lease royalty chain. */
export const ENERGY_ROYALTY_DECIMAL: PackRule = {
  id: 'energy-royalty-decimal',
  version: '1',
  evidenceTypes: READS,
  detect: ({ evidence }) => {
    const rows = energyRows(evidence);
    const production = productionModel(rows);
    return decimalChecks(rows, production).map((check): PackRuleProposal => {
      const over = check.direction === 'OVERPAID';
      return {
        key: check.interestId,
        domain: 'FINANCIAL',
        title: `Royalty decimal error: ${check.name}`,
        description: `The division order pays ${check.name} (${check.interestId}) a decimal of ${check.stated.toFixed(8)}; the lease royalty chain on ${check.leaseId} supports ${check.computed.toFixed(8)}. The interest is ${over ? 'overpaid' : 'underpaid'} by ${check.difference.abs().toFixed(8)} — about ${money(check.yearly)} a year on its trailing gross revenue. ${over ? 'Income the operator can recoup from the buyer, and that the seller’s revenue overstates.' : 'Income the seller has not been paid: a correction to ask the operator for.'}`,
        severity: over ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: over ? -1 : 0,
        directionRationale: over ? 'Overpaid income is overstated and can be recouped: a drag the reviewer prices.' : 'An underpayment is a recovery to claim from the operator, not a price term; upside never raises the price.',
        evidenceIds: cited([...check.evidenceIds, ...(production.byAsset.get(check.interestId)?.lineIds.slice(0, 4) ?? [])]),
      };
    });
  },
};

/** A plant's PPA expires inside the hold, leaving merchant exposure. */
export const ENERGY_PPA_CLIFF: PackRule = {
  id: 'energy-ppa-cliff',
  version: '1',
  evidenceTypes: READS,
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = energyRows(evidence);
    const production = productionModel(rows);
    const hold = energyHoldYears(pages);
    return ppaCliffs(rows, production, hold.years).map((cliff): PackRuleProposal => {
      const merchant = cliff.contractedShare ? new D(1).minus(cliff.contractedShare) : null;
      return {
        key: `${cliff.plantId}:${cliff.expiresOn}`,
        domain: 'COMMERCIAL',
        title: `PPA cliff: ${cliff.name}`,
        description: `${cliff.name}'s power purchase agreement${cliff.counterparty ? ` with ${cliff.counterparty}` : ''} ends on ${cliff.expiresOn}, inside the ${hold.years}-year hold. ${cliff.contractedShare ? `In the twelve months to ${production.analysisDate}, ${percent(cliff.contractedShare)} of its revenue (${money(cliff.contractedRevenue)} of ${money(cliff.trailingRevenue)}) was contracted and ${percent(merchant as Decimal)} merchant; after the PPA ends, all of it is merchant unless it is recontracted.` : 'No revenue is on file to measure the contracted share.'}`,
        severity: cliff.contractedShare && cliff.contractedShare.gte('0.5') ? 'HIGH' : 'MEDIUM',
        confidence: cliff.contractedShare ? 'HIGH' : 'MEDIUM',
        direction: 0,
        directionRationale: 'Merchant exposure after the PPA is a price-and-volume sensitivity in the scenarios, not a price term on its own.',
        evidenceIds: cited([cliff.evidenceId, ...cliff.lineIds.slice(0, 12)]),
      };
    });
  },
};

const TITLE_BREAK = /\b(break|gap|defect|missing link|unreleased|not of record|unrecorded)\b/i;
const NO_BREAK = /\bno\s+(?:breaks?|gaps?|defects?)\b/i;

/** A break in the mineral or asset chain of title, as a title opinion states it. */
export const ENERGY_TITLE_DEFECT: PackRule = {
  id: 'energy-title-defect',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const proposals: PackRuleProposal[] = [];
    for (const page of pages) {
      const sentence = sentences(page.text).find((candidate) => /chain of title/i.test(candidate) && TITLE_BREAK.test(candidate) && !NO_BREAK.test(candidate));
      if (!sentence) continue;
      const quote = sentence.length > 400 ? sentence.slice(0, 400) : sentence;
      proposals.push({
        key: `${page.documentId}:${page.pageNumber}`,
        domain: 'LEGAL',
        title: 'Title defect: break in the chain of title',
        description: `The title opinion states a break in the chain of title: “${quote}”. Until it is cured, the seller has not shown how it holds the affected interest or asset. Pactlab makes no title determination; the examiner's requirement is for counsel to clear.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Title the buyer may not receive: a cure period before closing, or a holdback until the requirement is satisfied.',
        evidenceIds: [],
        quotes: [{ documentId: page.documentId, pageNumber: page.pageNumber, quote }],
      });
    }
    return proposals;
  },
};

const REQUIRED = /\b(permit|consent decree|order|rule|regulation)\b[^.]*\brequire[sd]?\b|\brequire[sd]?\b[^.]*\b(permit|consent decree|order|rule|regulation)\b/i;
const CONTROL = /\b(?:installation|install|retrofit|construction)\s+of\s+(?:an?\s+|the\s+|new\s+)*([a-z][a-z -]{2,60}?)(?=\s+(?:by|before|at|no later|to|on|in|within)\b|[,.;])/i;
const CAPEX_PLAN = /capital (?:expenditure|spending|investment) plan|capex plan/i;

/** Controls a permit or regulation requires that the seller's capex plan leaves out. */
export const ENERGY_COMPLIANCE_CAPEX_GAP: PackRule = {
  id: 'energy-compliance-capex-gap',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const plans = pages.filter((page) => CAPEX_PLAN.test(collapse(page.text)));
    const proposals: PackRuleProposal[] = [];
    for (const page of pages) {
      if (plans.some((plan) => plan.documentId === page.documentId)) continue;
      for (const sentence of sentences(page.text)) {
        const control = REQUIRED.test(sentence) ? CONTROL.exec(sentence)?.[1]?.trim() : null;
        const cost = control ? moneyIn(sentence) : null;
        if (!control || !cost || !cost.amount.gt(0)) continue;
        const inPlan = plans.find((plan) => collapse(plan.text).toLowerCase().includes(control.toLowerCase()));
        if (inPlan) continue;
        const quote = sentence.length > 400 ? sentence.slice(0, 400) : sentence;
        const quotes: PackRuleQuote[] = [{ documentId: page.documentId, pageNumber: page.pageNumber, quote }];
        const plan = plans[0] as PackRulePage | undefined;
        if (plan) {
          const heading = sentences(plan.text).find((candidate) => CAPEX_PLAN.test(candidate));
          if (heading) quotes.push({ documentId: plan.documentId, pageNumber: plan.pageNumber, quote: heading.length > 400 ? heading.slice(0, 400) : heading });
        }
        proposals.push({
          key: `${page.documentId}:${page.pageNumber}:${control.toLowerCase()}`,
          domain: 'REGULATORY',
          title: `Compliance capex gap: ${control}`,
          description: `A permit or regulation requires the ${control} (“${quote}”), at a stated cost of ${cost.currency} ${money(cost.amount)}, and ${plan ? 'the seller’s capital expenditure plan does not include it' : 'no capital expenditure plan in the data room includes it'}. Quantified at the cost the evidence states. Not regulatory advice: whether the requirement applies as written is for the parties' advisers.`,
          severity: 'HIGH',
          confidence: plan ? 'HIGH' : 'MEDIUM',
          direction: -1,
          directionRationale: 'Required spending the seller has not planned for: a remediation cost the reviewer prices off the price.',
          pricedRisk: { type: 'REMEDIATION_COST', currency: cost.currency, low: cost.amount.toFixed(2), high: cost.amount.toFixed(2), basis: 'The cost the permit, order or regulation states for the required control.' },
          evidenceIds: [],
          quotes,
        });
      }
    }
    return proposals;
  },
};

/** Oil & gas interests with production but no third-party reserve report in the evidence: a gap, never an estimate. */
export const ENERGY_RESERVE_REPORT_MISSING: PackRule = {
  id: 'energy-reserve-report-missing',
  version: '1',
  evidenceTypes: READS,
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = energyRows(evidence);
    const production = productionModel(rows);
    const producing = rows.interests.filter((interest) => (production.byAsset.get(interest.id)?.trailingBoe ?? new D(0)).gt(0));
    if (producing.length === 0 || reserveReportOnFile(rows, pages)) return [];
    return [
      {
        key: 'reserve-report',
        domain: 'OPERATIONAL',
        title: 'Reserve report missing',
        description: `${producing.length} oil & gas interest${producing.length === 1 ? '' : 's'} produce (${money(production.interestTrailingBoe)} BOE in the twelve months to ${production.analysisDate}), but no third-party reserve report is in the evidence. Pactlab never estimates reserves: ask the seller for the engineering report before the reserve-based DCF is relied on.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A gap in the evidence to close before pricing, not a price term.',
        evidenceIds: cited(producing.map((interest) => interest.evidenceId)),
      },
    ];
  },
};

export const ENERGY_RULES: readonly PackRule[] = [
  ENERGY_UNBOOKED_ENVIRONMENTAL,
  ENERGY_ARO_SHORTFALL,
  ENERGY_DECLINE_MISMATCH,
  ENERGY_LEASE_EXPIRY,
  ENERGY_ROYALTY_DECIMAL,
  ENERGY_PPA_CLIFF,
  ENERGY_TITLE_DEFECT,
  ENERGY_COMPLIANCE_CAPEX_GAP,
  ENERGY_RESERVE_REPORT_MISSING,
  ENERGY_GENERATION_TREND,
];

