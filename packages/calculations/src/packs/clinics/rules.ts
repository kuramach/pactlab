import { D } from '../../metrics/decimal';
import type { KeyExpense } from '../../pnl/trend';
import { amountOf, grouped, INVOICE_LINE, monthName, percent, rowMonth } from '../common';
import { CLINICIAN_MONTH } from '../healthcare/practice';
import { pnlTrendRules } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  clinicsAnalysisDate,
  ownerOnlyLines,
  ownerShare,
  PREMISES_SHORT_TERM_MONTHS,
  premisesStatuses,
  REFERRAL_MONTH,
  referralMonths,
  referralWindow,
  sellingOwner,
  SERVICE_LINE_MONTH,
  serviceLineMonths,
  serviceLineWindow,
  successionEvidence,
} from './practice';

/**
 * Small clinics pack rules (T-068, spec §19; extends healthcare, T-061).
 * Providers appear only as pseudonymous references and in aggregate; no
 * patient data is accepted and nothing here reaches a model (rule 7).
 */
const VOLUME = 'clinics.volume_month';
const EQUIPMENT = 'clinics.equipment';
const CODING = 'clinics.coding_quarter';
type Decimal = InstanceType<typeof D>;

/** One pseudonymous provider earns at least half of a site's revenue over the last twelve months. */
export const CLINICS_PROVIDER_CARRIES_SITE: PackRule = {
  id: 'clinics-provider-carries-site',
  version: '1',
  evidenceTypes: [VOLUME],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === VOLUME && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''));
    const window = [...new Set(rows.map((row) => row.canonical['month'] ?? ''))].sort().slice(-12);
    const inWindow = rows.filter((row) => window.includes(row.canonical['month'] ?? ''));
    const sites = [...new Set(inWindow.map((row) => row.canonical['site'] ?? ''))].filter(Boolean).sort();
    return sites.flatMap((site) => {
      const atSite = inWindow.filter((row) => row.canonical['site'] === site);
      const total = atSite.reduce((sum, row) => sum.plus(amountOf(row, 'revenue')), new D(0));
      const byProvider = new Map<string, Decimal>();
      for (const row of atSite) byProvider.set(row.canonical['provider_ref'] ?? '', (byProvider.get(row.canonical['provider_ref'] ?? '') ?? new D(0)).plus(amountOf(row, 'revenue')));
      const [provider, revenue] = [...byProvider.entries()].sort((a, b) => b[1].comparedTo(a[1]) || a[0].localeCompare(b[0]))[0] ?? [];
      if (!provider || !revenue || !total.gt(0) || revenue.div(total).lt('0.5')) return [];
      return [
        {
          key: `${site}:${provider}`,
          domain: 'PEOPLE' as const,
          title: `One provider carries ${site}`,
          description: `${provider} earns ${percent(revenue.div(total))} of ${site} revenue over the ${window.length} months to ${monthName(window.at(-1) ?? '')} — a retention risk after closing. Providers are pseudonymous; this is a site aggregate, not a performance view.`,
          severity: revenue.div(total).gte('0.7') ? ('HIGH' as const) : ('MEDIUM' as const),
          confidence: 'HIGH' as const,
          direction: -1 as const,
          directionRationale: 'Retention arrangements as a closing condition, or a price adjustment the reviewer sets.',
          evidenceIds: atSite.filter((row) => row.canonical['provider_ref'] === provider).slice(-MAX_CITED).map((row) => row.id),
        },
      ];
    });
  },
};

/** High-complexity coding above the policy's expected share in every quarter, cited to the policy. */
export const CLINICS_CODING_ABOVE_POLICY: PackRule = {
  id: 'clinics-coding-above-policy',
  version: '1',
  evidenceTypes: [CODING],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = evidence.filter((row) => row.evidenceType === CODING).sort((a, b) => (a.canonical['quarter'] ?? '').localeCompare(b.canonical['quarter'] ?? ''));
    const above = rows.filter((row) => amountOf(row, 'high_complexity_share').gt(amountOf(row, 'policy_benchmark').times('1.5')));
    const policy = findSentence(pages, (sentence) => /(highest|high)[- ]complexity/i.test(sentence) && /\d+\s*%/.test(sentence));
    if (rows.length === 0 || above.length !== rows.length || !policy) return [];
    const shares = rows.map((row) => amountOf(row, 'high_complexity_share'));
    const low = D.min(...shares);
    const high = D.max(...shares);
    return [
      {
        key: `${rows[0]?.canonical['quarter']}:${rows.at(-1)?.canonical['quarter']}`,
        domain: 'REGULATORY',
        title: 'High-complexity coding above policy',
        description: `From ${rows[0]?.canonical['quarter']} to ${rows.at(-1)?.canonical['quarter']}, ${percent(low)}–${percent(high)} of visits are coded at the highest complexity against the ${percent(amountOf(rows[0] as PackRuleEvidence, 'policy_benchmark'))} the coding policy expects: “${policy.quote}” A coding audit before closing; repayment exposure is the reviewer's to price.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Overpayment recovery risk on past claims: an indemnity or escrow the reviewer prices after a coding audit.',
        evidenceIds: rows.map((row) => row.id),
        quotes: [{ documentId: policy.page.documentId, pageNumber: policy.page.pageNumber, quote: policy.quote }],
      },
    ];
  },
};

/** The end of the latest month in the billing import or, without it, the patient-volume extract. */
function asOf(evidence: readonly PackRuleEvidence[]): string | null {
  const months = evidence.map((row) => (row.evidenceType === INVOICE_LINE ? rowMonth(row) : row.evidenceType === VOLUME ? rowMonth(row, ['month']) : null)).filter((month): month is string => month !== null);
  const latest = months.sort().at(-1);
  return latest ? new Date(Date.UTC(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)), 0)).toISOString().slice(0, 10) : null;
}

/** Equipment in service beyond its useful life at the latest month; replacement is a remediation the reviewer prices. */
export const CLINICS_EQUIPMENT_PAST_LIFE: PackRule = {
  id: 'clinics-equipment-past-life',
  version: '1',
  evidenceTypes: [EQUIPMENT, INVOICE_LINE, VOLUME],
  detect: ({ evidence }) => {
    const date = asOf(evidence);
    if (!date) return [];
    const endOfLife = (row: PackRuleEvidence) => {
      const acquired = row.canonical['acquired'] ?? '';
      const years = amountOf(row, 'useful_life_years');
      return /^\d{4}-\d{2}-\d{2}/.test(acquired) && years.isInteger() ? `${Number(acquired.slice(0, 4)) + years.toNumber()}${acquired.slice(4, 10)}` : null;
    };
    const past = evidence.filter((row) => row.evidenceType === EQUIPMENT && !/retired|disposed/i.test(row.canonical['status'] ?? '') && (endOfLife(row) ?? '9999') <= date);
    if (past.length === 0) return [];
    return [
      {
        key: past.map((row) => row.sourceRecordId).sort().join(','),
        domain: 'OPERATIONAL',
        title: past.every((row) => /x-ray|imaging|\bmri\b|\bct\b|ultrasound|scanner/i.test(row.canonical['asset'] ?? '')) ? 'Imaging equipment past its useful life' : 'Equipment past its useful life',
        description: `${past.length} item${past.length > 1 ? 's are' : ' is'} in service past ${past.length > 1 ? 'their' : 'its'} useful life at ${date}: ${past.map((row) => `${row.canonical['asset']} at ${row.canonical['site']} (acquired ${row.canonical['acquired']}, ${row.canonical['useful_life_years']}-year life, ended ${endOfLife(row)})`).join('; ')}. Replacement is capital the buyer funds after closing.`,
        severity: past.length > 1 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Replacement capex as a remediation cost on the bridge, priced by the reviewer from quotes.',
        evidenceIds: past.map((row) => row.id),
      },
    ];
  },
};

// ---------------------------------------------------------------- owner, referrals, premises (T-161, ADR 0052)

const cite = (rows: readonly { id: string }[]) => rows.slice(0, MAX_CITED).map((row) => row.id);
const pct1 = (value: Decimal | null) => (value === null ? 'n/a' : percent(value));

/** The selling owner's share of collections (or visits) at or above this, with no succession on file, is a finding. */
export const OWNER_SHARE_THRESHOLD = '0.3';

/**
 * Owner-operator dependence: the selling owner (named by pseudonymous reference in a document) and
 * their share of visits and collections over the trailing twelve months, recomputed from the service
 * lines (or, without them, collections by clinician). Two drafts, each a retention risk the reviewer
 * prices or makes a term (a transition agreement, an earnout, a non-compete): a service line only the
 * owner delivers, with no associate collecting on it — HIGH when it is the highest-margin line; and an
 * owner carrying 30% or more with no succession or associate coverage on file. With no document naming
 * the owner, nothing is drafted: the Clinic page shows the absence.
 */
export const CLINICS_OWNER_DEPENDENCE: PackRule = {
  id: 'clinics-owner-dependence',
  version: '1',
  evidenceTypes: [SERVICE_LINE_MONTH, CLINICIAN_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const owner = sellingOwner(pages);
    if (!owner) return [];
    const ref = owner.providerRef;
    const out: PackRuleProposal[] = [];
    const window = serviceLineWindow(serviceLineMonths(evidence));
    if (window) {
      const best = window.lines.find((line) => line.margin !== null) ?? null;
      for (const line of ownerOnlyLines(window, ref)) {
        const isBest = best?.serviceLine === line.serviceLine;
        const rank = line.margin ? window.lines.filter((other) => other.margin?.gt(line.margin as Decimal)).length + 1 : null;
        out.push({
          key: `${ref}:${line.serviceLine}:sole`,
          domain: 'PEOPLE',
          title: isBest ? `The selling owner is the only provider of the highest-margin service line: ${line.serviceLine}` : `The selling owner is the only provider of ${line.serviceLine}`,
          description:
            `${owner.quote.quote} In the service-line export, ${window.from} to ${window.to}, ${line.serviceLine} collected ${grouped(line.collected)} (${pct1(line.share)} of all collections)` +
            (line.margin ? ` at a ${pct1(line.margin)} margin after direct costs${rank ? `, ${isBest ? 'the highest' : `number ${rank}`} of ${window.lines.filter((other) => other.margin).length} lines` : ''}` : '') +
            `, and ${ref} is the only provider who collected on it: no associate covers it. ` +
            'A retention risk after closing, never a ranking: price it, or make a transition agreement or an earnout tied to the line a term.',
          severity: isBest || (line.share?.gte('0.2') ?? false) ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          directionRationale: 'The line’s earnings depend on one person who is selling; price the risk or make a transition agreement a closing condition.',
          evidenceIds: cite(line.rows),
          quotes: [owner.quote],
        });
      }
    }
    const share = ownerShare(evidence, ref);
    const succession = successionEvidence(pages);
    const carried = [share?.collectionShare, share?.visitShare].some((value) => value?.gte(OWNER_SHARE_THRESHOLD));
    if (share && carried && !succession?.inPlace) {
      const source = share.source === 'SERVICE_LINES' ? 'service-line export' : 'collections-by-clinician export';
      const quotes: PackRuleQuote[] = [owner.quote, ...(succession ? [succession.quote] : [])];
      out.push({
        key: `${ref}:${share.from}:${share.to}:no-succession`,
        domain: 'PEOPLE',
        title: `The selling owner delivers ${pct1(share.collectionShare)} of collections, with no succession or associate coverage on file`,
        description:
          `${owner.quote.quote} In the ${source}, ${share.from} to ${share.to}, ${ref} collected ${grouped(share.collected)} (${pct1(share.collectionShare)} of collections)` +
          (share.visits && share.visitShare ? ` across ${share.visits.toFixed(0)} visits (${pct1(share.visitShare)} of visits)` : '') +
          '. ' +
          (succession ? `The documents say: “${succession.quote.quote}” ` : 'No document describes a succession plan, a transition period or associate coverage. ') +
          'Collections may follow the owner out of the door; price it, or make a transition agreement and associate coverage terms of the deal.',
        severity: (share.collectionShare?.gte('0.5') ?? false) ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Earnings that leave with the seller: a haircut on the collections the scenarios assume, or an earnout and transition terms.',
        evidenceIds: cite(share.rows),
        quotes,
      });
    }
    return out;
  },
};

/** Self-referrals, walk-ins and direct bookings: patients choosing the clinic themselves, never one referrer. */
const SELF_REFERRAL = /\b(?:self[- ]?referr\w*|walk[- ]?ins?|direct (?:booking|access)|online booking)\b/i;
export const isSelfReferral = (source: { readonly source: string; readonly sourceType: string }) => SELF_REFERRAL.test(source.sourceType) || SELF_REFERRAL.test(source.source);

/** One referral source at or above this share of visits is a finding. */
export const REFERRAL_CONCENTRATION_THRESHOLD = '0.4';

/**
 * Referral concentration: visits by referral source over the trailing twelve months, recomputed from
 * the referral export. A single dominant source (40% or more of visits; patients who refer themselves are
 * not one source) is a drag: if it stops
 * referring, volume falls. Arithmetic only: whether a referral arrangement is lawful is for counsel.
 */
export const CLINICS_REFERRAL_CONCENTRATION: PackRule = {
  id: 'clinics-referral-concentration',
  version: '1',
  evidenceTypes: [REFERRAL_MONTH],
  detect: ({ evidence }) => {
    const window = referralWindow(referralMonths(evidence));
    // Patients who come on their own are many people, not one source.
    const top = window?.sources.find((source) => !isSelfReferral(source));
    if (!window || !top?.share || top.share.lt(REFERRAL_CONCENTRATION_THRESHOLD)) return [];
    const next = window.sources.find((source) => source !== top);
    return [
      {
        key: `${top.source}:${window.from}:${window.to}`,
        domain: 'COMMERCIAL',
        title: `${pct1(top.share)} of visits come from one referral source: ${top.source}`,
        description:
          `Recomputed from the referral export, ${window.from} to ${window.to}: ${top.source}${top.sourceType ? ` (${top.sourceType})` : ''} referred ${top.visits.toFixed(0)} of ${window.visits.toFixed(0)} visits, ${pct1(top.share)}` +
          (next ? `; the next largest, ${next.source}, ${pct1(next.share)}` : '') +
          ` across ${window.sources.length} source${window.sources.length === 1 ? '' : 's'}.${window.missing.length ? ` Months missing from the export: ${window.missing.join(', ')}.` : ''} ` +
          'If it stops referring, volume falls; price it as a haircut on the visits the scenarios assume. Pactlab reports arithmetic only: whether a referral arrangement is lawful is for counsel.',
        severity: top.share.gte('0.5') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Volume that depends on one referrer: a haircut on visits, or a closing condition on the referral relationship.',
        evidenceIds: cite(top.rows),
      },
    ];
  },
};

const RENEWAL_TEXT = { GRANTED: 'the lease grants a renewal option', NONE: 'the lease states there is no renewal option', NOT_STATED: 'no sentence in the lease grants a renewal option' } as const;
const ASSIGNMENT_TEXT = {
  FREE: 'it may be assigned on a sale',
  CONSENT: 'assigning it on a sale needs the landlord’s consent',
  PROHIBITED: 'it may not be assigned',
  NOT_STATED: 'it says nothing on assignment or a change of control',
} as const;

/**
 * The clinic's premises, read from the lease: the term left after the expected closing (a document's
 * stated closing date, else the analysis date), whether it can be renewed, and whether it can be
 * assigned on a sale. A term ending within 24 months with no renewal option is a drag the reviewer
 * prices as relocation or renegotiation risk; an assignment that needs the landlord's consent, or is
 * barred, is a closing condition. Dates and sentences only, never a reading of the lease in law.
 */
export const CLINICS_PREMISES: PackRule = {
  id: 'clinics-premises',
  version: '1',
  evidenceTypes: [SERVICE_LINE_MONTH, REFERRAL_MONTH, CLINICIAN_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) =>
    premisesStatuses(pages, clinicsAnalysisDate(evidence)).flatMap((status): PackRuleProposal[] => {
      const { lease, from } = status;
      const quotes = [lease.heading, lease.expiry, lease.renewalQuote, lease.assignmentQuote].filter((quote): quote is PackRuleQuote => quote !== null);
      const unique = quotes.filter((quote, index) => quotes.findIndex((other) => other.quote === quote.quote && other.pageNumber === quote.pageNumber) === index);
      const measured = from ? (from.basis === 'EXPECTED_CLOSING' ? `the expected closing on ${from.date}` : `${from.date}, the end of the latest month in the exports (no document states a closing date)`) : '';
      const out: PackRuleProposal[] = [];
      if (status.short && lease.renewal !== 'GRANTED' && lease.expiresOn) {
        out.push({
          key: `${lease.documentId}:${lease.expiresOn}:short-term`,
          domain: 'PROPERTY',
          title: `Clinic lease ends ${status.monthsRemaining} month${status.monthsRemaining === 1 ? '' : 's'} after closing, with no renewal option`,
          description:
            `The lease term ends on ${lease.expiresOn}, ${status.monthsRemaining} whole month${status.monthsRemaining === 1 ? '' : 's'} after ${measured}; ${RENEWAL_TEXT[lease.renewal]}, and ${ASSIGNMENT_TEXT[lease.assignment]}. ` +
            `Within ${PREMISES_SHORT_TERM_MONTHS} months the clinic must renegotiate on the landlord’s terms or relocate. Price it as relocation or renegotiation risk (a holdback or a price reduction the reviewer sets), or make a new lease a closing condition.`,
          severity: (status.monthsRemaining ?? 0) <= 18 ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          directionRationale: 'Relocation or renegotiation cost after closing, priced by the reviewer from quotes or a rent survey.',
          evidenceIds: [],
          quotes: unique,
        });
      }
      if (lease.assignment === 'CONSENT' || lease.assignment === 'PROHIBITED') {
        out.push({
          key: `${lease.documentId}:assignment:${lease.assignment}`,
          domain: 'PROPERTY',
          title: lease.assignment === 'CONSENT' ? 'Clinic lease: assignment on a sale needs the landlord’s consent' : 'Clinic lease may not be assigned',
          description: `“${lease.assignmentQuote?.quote ?? ''}” Make the landlord’s written consent (or a new lease) a closing condition. A reading of the sentence, not legal advice.`,
          severity: lease.assignment === 'PROHIBITED' ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: 0,
          directionRationale: 'A closing condition, not a price term.',
          evidenceIds: [],
          quotes: lease.assignmentQuote ? [lease.assignmentQuote] : [],
        });
      }
      return out;
    }),
};

/** A clinic's key expenses for the multi-year P&L trend: supplies, lab fees, clinical staff and occupancy. */
export const CLINICS_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'supplies', label: 'Clinical and dental supplies', pattern: /\bsuppl(?:y|ies)\b/i },
  { key: 'lab', label: 'Laboratory fees', pattern: /\blab(?:oratory)? (?:fees?|costs?)\b/i },
  { key: 'clinical', label: 'Clinical staff costs', pattern: /\bclinical (?:staff|labou?r)\b|\bassociate (?:pay|costs?)\b/i },
  { key: 'occupancy', label: 'Rent and occupancy', pattern: /\b(?:rent|occupancy)\b/i },
];

export const [CLINICS_PNL_TREND, CLINICS_PNL_MARGIN_DRIFT, CLINICS_PNL_EXPENSE_OUTPACING] = pnlTrendRules('clinics', CLINICS_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

export const CLINICS_RULES: readonly PackRule[] = [
  CLINICS_PROVIDER_CARRIES_SITE,
  CLINICS_CODING_ABOVE_POLICY,
  CLINICS_EQUIPMENT_PAST_LIFE,
  CLINICS_OWNER_DEPENDENCE,
  CLINICS_REFERRAL_CONCENTRATION,
  CLINICS_PREMISES,
  CLINICS_PNL_TREND,
  CLINICS_PNL_MARGIN_DRIFT,
  CLINICS_PNL_EXPENSE_OUTPACING,
];
export const CLINICS_EVIDENCE = { VOLUME, EQUIPMENT, CODING, SERVICE_LINE_MONTH, REFERRAL_MONTH } as const;
