import Decimal from 'decimal.js';
import { D, parseDecimal } from '../../metrics/decimal';
import type { WaterfallResult, WaterfallTerms } from '../../syndication/waterfall';
import { MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import { occupied, of, UNIT } from '../multifamily/shared';

/**
 * Multifamily syndication checks (T-106). Two kinds:
 * - `syndication-track-record-thin`, a registry rule over the imported track record;
 * - `offeringChecks`, run over the offering items a sponsor has confirmed (terms and claims read
 *   from the PPM, operating agreement and deck, each with its exact quote and page) and the
 *   recomputed waterfall. The API wraps it as a rule so the findings register and its
 *   fingerprints, citations and claims apply unchanged.
 * Deterministic, decimal-only; drafts for a person. Offering-document defects are neutral: they
 * are corrected in the documents and disclosed, they do not change the property's price.
 */
export const PRIOR_DEAL = 'syndication.prior_deal';
export const OFFERING_CHECKS_ID = 'syndication-offering';
export const OFFERING_CHECKS_VERSION = 'syndication-offering-1';

type Dec = InstanceType<typeof D>;
const percent = (value: Dec) => value.dividedBy(100);
const pts = (value: Dec) => `${value.toFixed(2, Decimal.ROUND_HALF_EVEN)}`;
const normalize = (text: string) => text.toLowerCase().replace(/\(synthetic\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Thin when fewer than this many prior deals have documented actual returns. */
export const THIN_TRACK_RECORD = 3;

export const SYNDICATION_TRACK_RECORD_THIN: PackRule = {
  id: 'syndication-track-record-thin',
  version: '1',
  evidenceTypes: [PRIOR_DEAL],
  detect: ({ evidence }) => {
    const deals = of(evidence, PRIOR_DEAL);
    if (deals.length === 0) return [];
    const documented = deals.filter((row) => parseDecimal(row.canonical['actual_irr_pct']) !== null || parseDecimal(row.canonical['actual_multiple']) !== null);
    if (documented.length >= THIN_TRACK_RECORD) return [];
    const missing = deals.filter((row) => !documented.includes(row)).map((row) => row.canonical['deal'] ?? row.sourceRecordId);
    return [
      {
        key: 'thin',
        domain: 'COMMERCIAL',
        title: 'Thin sponsor track record',
        description: `${documented.length} of ${deals.length} prior deals in the track record have documented actual returns${missing.length ? `; no actuals for ${missing.slice(0, 8).join(', ')}` : ''}. Fewer than ${THIN_TRACK_RECORD} deals with actuals is a thin record for investors to judge the sponsor on.`,
        severity: documented.length === 0 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A gap investors will diligence; ask the sponsor for the missing actuals. It does not change the property price.',
        evidenceIds: deals.slice(0, MAX_CITED).map((row) => row.id),
      },
    ];
  },
};

export const SYNDICATION_RULES: readonly PackRule[] = [SYNDICATION_TRACK_RECORD_THIN];

/** One confirmed item from the offering documents. Percent figures are percent (8 = 8%). */
export interface OfferingCheckItem {
  readonly id: string;
  readonly kind: string;
  readonly source: 'PPM' | 'OPERATING_AGREEMENT' | 'DECK';
  readonly label: string | null;
  readonly value: string | null;
  /** Promote tiers: the investors' IRR hurdle (percent); `value` is then the sponsor's share. */
  readonly hurdle: string | null;
  readonly documentId: string;
  readonly pageNumber: number;
  readonly quote: string;
}

const FEE_KINDS = ['ACQUISITION_FEE', 'ASSET_MANAGEMENT_FEE', 'DISPOSITION_FEE', 'OTHER_FEE'] as const;
const FEE_LABELS: Record<string, string> = { ACQUISITION_FEE: 'acquisition fee', ASSET_MANAGEMENT_FEE: 'asset-management fee', DISPOSITION_FEE: 'disposition fee' };
const feeName = (item: OfferingCheckItem) => (item.kind === 'OTHER_FEE' ? (item.label ?? 'other fee').toLowerCase() : FEE_LABELS[item.kind]!);
const feeKey = (item: OfferingCheckItem) => (item.kind === 'OTHER_FEE' ? `OTHER:${normalize(item.label ?? '')}` : item.kind);
const quoteOf = (item: OfferingCheckItem): PackRuleQuote => ({ documentId: item.documentId, pageNumber: item.pageNumber, quote: item.quote });
const num = (value: string | null | undefined) => parseDecimal(value ?? null);

/**
 * The waterfall terms the operating agreement sets (it governs; the PPM only describes it).
 * Missing pieces are named; a catch-up is flagged as not modelled.
 */
export function waterfallTermsFrom(items: readonly OfferingCheckItem[]): { terms: WaterfallTerms | null; missing: string[]; unmodelled: string[] } {
  const oa = items.filter((item) => item.source === 'OPERATING_AGREEMENT');
  const one = (kind: string) => num(oa.find((item) => item.kind === kind)?.value ?? null);
  const pref = one('PREFERRED_RETURN');
  const tiers = oa
    .filter((item) => item.kind === 'PROMOTE_TIER' && num(item.value) !== null)
    .map((item) => ({ hurdle: num(item.hurdle), gpShare: num(item.value)! }))
    .sort((a, b) => (a.hurdle === null ? 1 : b.hurdle === null ? -1 : a.hurdle.comparedTo(b.hurdle)));
  const missing = [...(pref === null ? ['the preferred return'] : []), ...(tiers.length === 0 || tiers[tiers.length - 1]!.hurdle !== null ? ['a final promote split with no hurdle'] : [])];
  const unmodelled = [
    ...(oa.some((item) => item.kind === 'CATCH_UP') ? ['a sponsor catch-up'] : []),
    // Other fees have no fixed basis the model can apply; they are named, never silently dropped.
    ...oa.filter((item) => item.kind === 'OTHER_FEE').map((item) => `the ${feeName(item)}`),
  ];
  if (missing.length > 0) return { terms: null, missing, unmodelled };
  return {
    terms: {
      prefRate: percent(pref!),
      tiers: tiers.map((tier) => ({ hurdle: tier.hurdle === null ? null : percent(tier.hurdle), gpShare: percent(tier.gpShare) })),
      acquisitionFee: percent(one('ACQUISITION_FEE') ?? new D(0)),
      assetManagementFee: percent(one('ASSET_MANAGEMENT_FEE') ?? new D(0)),
      dispositionFee: percent(one('DISPOSITION_FEE') ?? new D(0)),
    },
    missing,
    unmodelled,
  };
}

export interface OfferingCheckInput {
  readonly items: readonly OfferingCheckItem[];
  /** The base-case waterfall from the operating agreement's terms; null when it could not run. */
  readonly base: WaterfallResult | null;
  /** Why it could not run, for the claims it leaves unverified. */
  readonly baseUnavailable: string | null;
  /** Imported track record and rent-roll units. */
  readonly evidence: readonly PackRuleEvidence[];
}

export interface OfferingClaimOutcome {
  readonly itemId: string;
  readonly statement: string;
  readonly status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED';
  readonly rationale: string;
  /** The proposal that drafts a finding for this claim, when there is one. */
  readonly proposalKey: string | null;
  readonly evidenceIds: readonly string[];
}

const SOURCE_NAME = { PPM: 'PPM', OPERATING_AGREEMENT: 'operating agreement', DECK: 'investor deck' } as const;

function statementOf(item: OfferingCheckItem): string {
  const where = SOURCE_NAME[item.source];
  const v = item.value ?? '—';
  switch (item.kind) {
    case 'PROJECTED_IRR':
      return `${where}: projected investor IRR ${v}%`;
    case 'EQUITY_MULTIPLE':
      return `${where}: projected equity multiple ${v}x`;
    case 'CASH_ON_CASH':
      return `${where}: projected average cash-on-cash ${v}%`;
    case 'OCCUPANCY':
      return `${where}: occupancy ${v}%`;
    case 'NOI_GROWTH':
      return `${where}: NOI growth ${v}% a year`;
    case 'EXIT_CAP_RATE':
      return `${where}: exit cap rate ${v}%`;
    case 'TRACK_RECORD':
      return `${where}: ${item.label ?? 'a prior deal'} delivered a ${v}% investor IRR`;
    default:
      return `${where}: ${item.kind.toLowerCase()} ${v}`;
  }
}

/** Run every offering check over the confirmed items. */
export function offeringChecks(input: OfferingCheckInput): { proposals: PackRuleProposal[]; claims: OfferingClaimOutcome[] } {
  const proposals: PackRuleProposal[] = [];
  const claims: OfferingClaimOutcome[] = [];
  const { items, base } = input;
  const claimItems = items.filter((item) => ['PROJECTED_IRR', 'EQUITY_MULTIPLE', 'CASH_ON_CASH', 'OCCUPANCY', 'NOI_GROWTH', 'EXIT_CAP_RATE', 'TRACK_RECORD'].includes(item.kind));

  // 1. Stated returns against the waterfall recomputed from the operating agreement.
  const returnChecks: Record<string, { field: 'irr' | 'equityMultiple' | 'averageCashOnCash'; tolerance: string; unit: string; noun: string }> = {
    PROJECTED_IRR: { field: 'irr', tolerance: '1', unit: '%', noun: 'investor IRR' },
    EQUITY_MULTIPLE: { field: 'equityMultiple', tolerance: '0.1', unit: 'x', noun: 'equity multiple' },
    CASH_ON_CASH: { field: 'averageCashOnCash', tolerance: '1', unit: '%', noun: 'average cash-on-cash' },
  };
  for (const item of claimItems) {
    const check = returnChecks[item.kind];
    if (!check) continue;
    const stated = num(item.value);
    const recomputed = base ? num(base.limitedPartners[check.field === 'irr' ? 'irr' : check.field]) : null;
    if (stated === null || recomputed === null) {
      claims.push({ itemId: item.id, statement: statementOf(item), status: 'UNVERIFIED', rationale: input.baseUnavailable ?? 'The waterfall could not be recomputed.', proposalKey: null, evidenceIds: [] });
      continue;
    }
    const gap = stated.minus(recomputed).abs();
    if (gap.lte(check.tolerance)) {
      claims.push({ itemId: item.id, statement: statementOf(item), status: 'VERIFIED', rationale: `Recomputed from the operating agreement's terms on the base case: ${recomputed.toFixed()}${check.unit}.`, proposalKey: null, evidenceIds: [] });
      continue;
    }
    const key = `${item.kind.toLowerCase()}:${item.source}`;
    proposals.push({
      key,
      domain: 'FINANCIAL',
      title: `Stated ${check.noun} inconsistent with the recomputed waterfall`,
      description: `The ${SOURCE_NAME[item.source]} states a ${check.noun} of ${stated.toFixed()}${check.unit}; the waterfall recomputed from the operating agreement's fees, preferred return and promote on the offering's base case gives ${recomputed.toFixed()}${check.unit} (a gap of ${pts(gap)}${check.unit === '%' ? ' points' : 'x'}). The base case is a scenario computed from stated assumptions, not a projection.`,
      severity: gap.gt(new D(check.tolerance).times(3)) ? 'HIGH' : 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'An offering-document defect: correct the figure before investors rely on it. It does not change the property price.',
      evidenceIds: [],
      quotes: [quoteOf(item)],
    });
    claims.push({ itemId: item.id, statement: statementOf(item), status: 'CONTRADICTED', rationale: `Recomputed ${check.noun}: ${recomputed.toFixed()}${check.unit}, ${pts(gap)} away.`, proposalKey: key, evidenceIds: [] });
  }

  // 2. Track-record claims against the imported track record; no actuals is a gap, never a blank.
  const deals = of(input.evidence, PRIOR_DEAL);
  for (const item of claimItems.filter((claim) => claim.kind === 'TRACK_RECORD')) {
    const name = normalize(item.label ?? '');
    const row = deals.find((deal) => name.length > 0 && normalize(deal.canonical['deal'] ?? deal.sourceRecordId) === name);
    const actual = row ? num(row.canonical['actual_irr_pct']) : null;
    const stated = num(item.value);
    if (row && actual !== null && stated !== null && stated.minus(actual).abs().lte('1')) {
      claims.push({ itemId: item.id, statement: statementOf(item), status: 'VERIFIED', rationale: `The track record documents an actual IRR of ${actual.toFixed()}%.`, proposalKey: null, evidenceIds: [row.id] });
      continue;
    }
    const key = `track-record:${name || item.id}`;
    const contradicted = row !== undefined && actual !== null && stated !== null;
    proposals.push({
      key,
      domain: 'COMMERCIAL',
      title: contradicted ? `Track-record claim contradicted: ${item.label}` : `Track-record claim with no actuals behind it: ${item.label ?? 'a prior deal'}`,
      description: contradicted
        ? `The ${SOURCE_NAME[item.source]} says ${item.label} delivered ${stated!.toFixed()}%; the track record documents ${actual!.toFixed()}%.`
        : `The ${SOURCE_NAME[item.source]} says ${item.label ?? 'a prior deal'} delivered ${item.value ?? 'a stated'}% to investors, but ${row ? 'the track record has no actual return for that deal' : 'the track record does not list that deal'}. Shown as unverified until the sponsor supplies the actuals (distribution statements or K-1 summaries).`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A disclosure gap for investors; it does not change the property price.',
      evidenceIds: row ? [row.id] : [],
      quotes: [quoteOf(item)],
    });
    claims.push({
      itemId: item.id,
      statement: statementOf(item),
      status: contradicted ? 'CONTRADICTED' : 'UNVERIFIED',
      rationale: contradicted ? `The track record documents ${actual!.toFixed()}%.` : row ? 'The track record lists the deal with no actual return.' : 'The deal is not in the track record.',
      proposalKey: key,
      evidenceIds: row ? [row.id] : [],
    });
  }

  // 3. Occupancy against the rent roll.
  const units = of(input.evidence, UNIT);
  for (const item of claimItems.filter((claim) => claim.kind === 'OCCUPANCY')) {
    const stated = num(item.value);
    if (units.length === 0 || stated === null) {
      claims.push({ itemId: item.id, statement: statementOf(item), status: 'UNVERIFIED', rationale: 'No rent roll imported yet.', proposalKey: null, evidenceIds: [] });
      continue;
    }
    const actual = new D(occupied(units).length).dividedBy(units.length).times(100);
    const gap = stated.minus(actual).abs();
    const cited = units.slice(0, MAX_CITED).map((row) => row.id);
    if (gap.lte('2')) {
      claims.push({ itemId: item.id, statement: statementOf(item), status: 'VERIFIED', rationale: `The rent roll shows ${actual.toFixed(1)}% occupied.`, proposalKey: null, evidenceIds: cited });
      continue;
    }
    const key = `occupancy:${item.source}`;
    proposals.push({
      key,
      domain: 'PROPERTY',
      title: 'Stated occupancy differs from the rent roll',
      description: `The ${SOURCE_NAME[item.source]} states ${stated.toFixed()}% occupancy; the rent roll shows ${actual.toFixed(1)}% (${occupied(units).length} of ${units.length} units).`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'Correct the offering figure; the property is valued on the rent roll.',
      evidenceIds: cited,
      quotes: [quoteOf(item)],
    });
    claims.push({ itemId: item.id, statement: statementOf(item), status: 'CONTRADICTED', rationale: `The rent roll shows ${actual.toFixed(1)}% occupied.`, proposalKey: key, evidenceIds: cited });
  }

  // 4. Assumptions are scenario inputs, never facts.
  for (const item of claimItems.filter((claim) => claim.kind === 'NOI_GROWTH' || claim.kind === 'EXIT_CAP_RATE'))
    claims.push({ itemId: item.id, statement: statementOf(item), status: 'UNVERIFIED', rationale: 'An assumption, not a fact: it is tested as a scenario input, never verified.', proposalKey: null, evidenceIds: [] });

  // 5. Fees the operating agreement charges against the PPM's fee summary.
  const ppmFees = items.filter((item) => item.source === 'PPM' && (FEE_KINDS as readonly string[]).includes(item.kind));
  for (const fee of items.filter((item) => item.source === 'OPERATING_AGREEMENT' && (FEE_KINDS as readonly string[]).includes(item.kind))) {
    const described = ppmFees.find((item) => feeKey(item) === feeKey(fee));
    if (!described) {
      proposals.push({
        key: `fee-missing:${feeKey(fee)}`,
        domain: 'LEGAL',
        title: `Fee in the operating agreement missing from the PPM: ${feeName(fee)}`,
        description: `The operating agreement charges a ${feeName(fee)} of ${fee.value ?? 'an amount'}%; the PPM's fee summary does not list it. Investors read the PPM.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A disclosure gap in the offering documents for the sponsor and counsel; it does not change the property price.',
        evidenceIds: [],
        quotes: [quoteOf(fee)],
      });
      continue;
    }
    const a = num(fee.value);
    const b = num(described.value);
    if (a !== null && b !== null && !a.eq(b))
      proposals.push({
        key: `fee-mismatch:${feeKey(fee)}`,
        domain: 'LEGAL',
        title: `Fee differs between the operating agreement and the PPM: ${feeName(fee)}`,
        description: `The operating agreement sets the ${feeName(fee)} at ${a.toFixed()}%; the PPM describes ${b.toFixed()}%.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A disclosure inconsistency for the sponsor and counsel; it does not change the property price.',
        evidenceIds: [],
        quotes: [quoteOf(fee), quoteOf(described)],
      });
  }

  // 6. The PPM's description of the waterfall against the operating agreement's math.
  const prefOf = (source: OfferingCheckItem['source']) => items.find((item) => item.source === source && item.kind === 'PREFERRED_RETURN');
  const [oaPref, ppmPref] = [prefOf('OPERATING_AGREEMENT'), prefOf('PPM')];
  if (oaPref && ppmPref && num(oaPref.value) && num(ppmPref.value) && !num(oaPref.value)!.eq(num(ppmPref.value)!))
    proposals.push({
      key: 'pref-mismatch',
      domain: 'LEGAL',
      title: 'Preferred return described differently in the PPM',
      description: `The operating agreement sets a ${num(oaPref.value)!.toFixed()}% preferred return; the PPM describes ${num(ppmPref.value)!.toFixed()}%.`,
      severity: 'HIGH',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A disclosure inconsistency for the sponsor and counsel; it does not change the property price.',
      evidenceIds: [],
      quotes: [quoteOf(oaPref), quoteOf(ppmPref)],
    });
  const tiersOf = (source: OfferingCheckItem['source']) =>
    items
      .filter((item) => item.source === source && item.kind === 'PROMOTE_TIER')
      .map((item) => ({ item, signature: `${num(item.hurdle)?.toFixed() ?? '∞'}:${num(item.value)?.toFixed() ?? '?'}` }))
      .sort((a, b) => a.signature.localeCompare(b.signature));
  const [oaTiers, ppmTiers] = [tiersOf('OPERATING_AGREEMENT'), tiersOf('PPM')];
  if (oaTiers.length > 0 && ppmTiers.length > 0 && oaTiers.map((t) => t.signature).join('|') !== ppmTiers.map((t) => t.signature).join('|'))
    proposals.push({
      key: 'split-mismatch',
      domain: 'LEGAL',
      title: 'Promote splits described differently in the PPM',
      description: `The operating agreement's promote tiers (${oaTiers.map((t) => t.signature).join(', ')}, as hurdle:sponsor share) differ from the PPM's (${ppmTiers.map((t) => t.signature).join(', ')}).`,
      severity: 'HIGH',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A disclosure inconsistency for the sponsor and counsel; it does not change the property price.',
      evidenceIds: [],
      quotes: [...oaTiers, ...ppmTiers].slice(0, MAX_CITED).map((t) => quoteOf(t.item)),
    });

  return { proposals, claims };
}
