import { D } from '../../metrics/decimal';
import { amountOf, grouped, INVOICE_LINE, moneyIn, monthName, percent, rowMonth } from '../common';
import { pnlTrendRule, type PnlExpenseLine } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleQuote } from '../rule-types';

/**
 * Small clinics pack rules (T-068, spec §19; extends healthcare, T-061).
 * Providers appear only as pseudonymous references and in aggregate; no
 * patient data is accepted and nothing here reaches a model (rule 7).
 */
const VOLUME = 'clinics.volume_month';
const EQUIPMENT = 'clinics.equipment';
const CODING = 'clinics.coding_quarter';
const VISITS = 'clinics.visit_month';
const SERVICE_LINES = 'clinics.service_line_year';
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

/** The few-site variant (T-161): visit rows of the twelve months to the latest month in the visit summary. */
export function trailingVisits(evidence: readonly PackRuleEvidence[]): { window: string[]; rows: PackRuleEvidence[] } {
  const rows = evidence.filter((row) => row.evidenceType === VISITS && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''));
  const window = [...new Set(rows.map((row) => row.canonical['month'] ?? ''))].sort().slice(-12);
  return { window, rows: rows.filter((row) => window.includes(row.canonical['month'] ?? '')) };
}

const isOwner = (row: PackRuleEvidence) => (row.canonical['provider_role'] ?? '').toLowerCase() === 'owner';
const sum = (rows: readonly PackRuleEvidence[], field: string) => rows.reduce((total, row) => total.plus(amountOf(row, field)), new D(0));

/** Each service line's margin in the latest fiscal year of the service-line import: (revenue − direct costs) ÷ revenue. */
export function serviceLineMargins(evidence: readonly PackRuleEvidence[]): { year: string; margins: Map<string, Decimal>; rows: PackRuleEvidence[] } | null {
  const rows = evidence.filter((row) => row.evidenceType === SERVICE_LINES && /^\d{4}$/.test(row.canonical['year'] ?? ''));
  const year = rows.map((row) => row.canonical['year'] ?? '').sort().at(-1);
  if (!year) return null;
  const latest = rows.filter((row) => row.canonical['year'] === year && amountOf(row, 'revenue').gt(0));
  const margins = new Map(latest.map((row) => [row.canonical['service_line'] ?? '', amountOf(row, 'revenue').minus(amountOf(row, 'direct_costs')).div(amountOf(row, 'revenue'))]));
  return { year, margins, rows: latest };
}

/** The selling owner's share of visits and collections, and the service lines nobody else delivers (T-161). */
export function ownerDependence(evidence: readonly PackRuleEvidence[]) {
  const { window, rows } = trailingVisits(evidence);
  const owners = rows.filter(isOwner);
  const lines = [...new Set(rows.map((row) => row.canonical['service_line'] ?? ''))].filter(Boolean).sort();
  const ownerOnly = lines.filter((line) => {
    const atLine = rows.filter((row) => row.canonical['service_line'] === line);
    return sum(atLine, 'visits').gt(0) && atLine.every((row) => isOwner(row) || amountOf(row, 'visits').isZero());
  });
  const visits = sum(rows, 'visits');
  const collections = sum(rows, 'collections');
  return {
    window,
    rows,
    owners,
    ownerRefs: [...new Set(owners.map((row) => row.canonical['provider_ref'] ?? ''))].filter(Boolean).sort(),
    visitShare: visits.gt(0) ? sum(owners, 'visits').div(visits) : null,
    collectionShare: collections.gt(0) ? sum(owners, 'collections').div(collections) : null,
    ownerOnly,
  };
}

/**
 * The selling owner delivers a large share of collections, or is the only provider of a service
 * line — no associate coverage. A succession or transition plan among the readable documents is
 * quoted; its absence is said as absence. Providers are pseudonymous; never a performance view.
 */
export const CLINICS_OWNER_DEPENDENCE: PackRule = {
  id: 'clinics-owner-dependence',
  version: '1',
  evidenceTypes: [VISITS, SERVICE_LINES],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const owner = ownerDependence(evidence);
    if (owner.owners.length === 0 || !owner.collectionShare || !owner.visitShare) return [];
    if (owner.ownerOnly.length === 0 && owner.collectionShare.lt('0.3')) return [];
    const margins = serviceLineMargins(evidence);
    const best = margins ? [...margins.margins.entries()].sort((a, b) => b[1].comparedTo(a[1]) || a[0].localeCompare(b[0]))[0] : undefined;
    const bestIsOwnerOnly = best !== undefined && owner.ownerOnly.includes(best[0]);
    const plan = findSentence(pages, (sentence) => /\b(succession|transition plan|associate coverage)\b/i.test(sentence));
    const who = owner.ownerRefs.join(', ');
    const lines = owner.ownerOnly.join(', ');
    const marginNote = !margins
      ? 'Service-line margins are not imported, so which line earns most is not known here.'
      : best
        ? `${bestIsOwnerOnly ? `${best[0]} is the highest-margin service line` : `The highest-margin service line is ${best[0]}`} in ${margins.year} (${percent(best[1])} margin).`
        : '';
    const quotes: PackRuleQuote[] = plan ? [{ documentId: plan.page.documentId, pageNumber: plan.page.pageNumber, quote: plan.quote }] : [];
    return [
      {
        key: `${who}:${lines || 'share'}`,
        domain: 'PEOPLE',
        title: owner.ownerOnly.length ? `Selling owner is the only provider of ${lines}` : `Selling owner delivers ${percent(owner.collectionShare)} of collections`,
        description:
          `Over the ${owner.window.length} months to ${monthName(owner.window.at(-1) ?? '')}, the selling owner (${who}, pseudonymous) delivered ${percent(owner.visitShare)} of visits and ${percent(owner.collectionShare)} of collections. ` +
          (owner.ownerOnly.length ? `No associate or contractor delivered any ${lines} visit: no associate coverage. ` : '') +
          `${marginNote} ` +
          (plan ? `On succession: “${plan.quote}”` : 'No succession or transition plan is among the documents filed.'),
        severity: bestIsOwnerOnly || owner.collectionShare.gte('0.5') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'A transition and employment agreement as a closing condition, or an earn-out the reviewer sizes.',
        evidenceIds: [
          ...owner.owners.filter((row) => owner.ownerOnly.length === 0 || owner.ownerOnly.includes(row.canonical['service_line'] ?? '')).slice(-30),
          ...(margins?.rows ?? []).slice(0, MAX_CITED - 30),
        ].map((row) => row.id),
        quotes,
      },
    ];
  },
};

const SELF_REFERRAL = /^(self|walk[- ]?in|direct|patient)/i;

/** Visits by referral source over the trailing twelve months; one outside source at 40% or more (T-161). */
export const CLINICS_REFERRAL_CONCENTRATION: PackRule = {
  id: 'clinics-referral-concentration',
  version: '1',
  evidenceTypes: [VISITS],
  detect: ({ evidence }) => {
    const { window, rows } = trailingVisits(evidence);
    const total = sum(rows, 'visits');
    if (!total.gt(0)) return [];
    const bySource = new Map<string, Decimal>();
    for (const row of rows) bySource.set(row.canonical['referral_source'] ?? '', (bySource.get(row.canonical['referral_source'] ?? '') ?? new D(0)).plus(amountOf(row, 'visits')));
    const [source, visits] = [...bySource.entries()].filter(([name]) => name && !SELF_REFERRAL.test(name)).sort((a, b) => b[1].comparedTo(a[1]) || a[0].localeCompare(b[0]))[0] ?? [];
    if (!source || !visits || visits.div(total).lt('0.4')) return [];
    const share = visits.div(total);
    return [
      {
        key: source,
        domain: 'COMMERCIAL',
        title: `One referral source sends ${percent(share)} of visits`,
        description: `${source} referred ${grouped(visits)} of ${grouped(total)} visits (${percent(share)}) over the ${window.length} months to ${monthName(window.at(-1) ?? '')}. If that source stops referring, most of the volume goes with it. Pactlab reads the visit counts only; it makes no judgment on the referral arrangement.`,
        severity: share.gte('0.5') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A volume sensitivity in the scenarios and a review of the referral relationship, not a price term.',
        evidenceIds: rows.filter((row) => row.canonical['referral_source'] === source).slice(-MAX_CITED).map((row) => row.id),
      },
    ];
  },
};

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (value: number) => String(value).padStart(2, '0');

/** The first date a sentence states, as YYYY-MM-DD: "2028-03-31", "31 March 2028" or "March 31, 2028". */
export function dateIn(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const names = MONTH_NAMES.join('|');
  const dayFirst = new RegExp(`\\b(\\d{1,2}) (${names}) (\\d{4})\\b`, 'i').exec(text);
  if (dayFirst) return `${dayFirst[3]}-${pad(MONTH_NAMES.indexOf((dayFirst[2] ?? '').toLowerCase()) + 1)}-${pad(Number(dayFirst[1]))}`;
  const monthFirst = new RegExp(`\\b(${names}) (\\d{1,2}),? (\\d{4})\\b`, 'i').exec(text);
  if (monthFirst) return `${monthFirst[3]}-${pad(MONTH_NAMES.indexOf((monthFirst[1] ?? '').toLowerCase()) + 1)}-${pad(Number(monthFirst[2]))}`;
  return null;
}

/** Whole months from one date to a later one (a part month does not count). */
export function wholeMonthsBetween(from: string, to: string): number {
  const [fy = 0, fm = 0, fd = 0] = from.split('-').map(Number);
  const [ty = 0, tm = 0, td = 0] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

/** Below this many months of lease left after closing, without a renewal option, the premises are a finding. */
export const CLINICS_SHORT_LEASE_MONTHS = 24;

/**
 * The clinic lease as evidence (T-161): its expiry, any renewal or extension option and the
 * assignment clause, read sentence by sentence from the filed documents and measured from the
 * stated target closing date (or, when none is stated, the end of the latest billed month). A short
 * remaining term without a renewal option is a relocation or renegotiation risk, priced from a
 * relocation estimate the documents state; dates and arithmetic only, no legal reading.
 */
export const CLINICS_LEASE_TERM: PackRule = {
  id: 'clinics-lease-term',
  version: '1',
  evidenceTypes: [INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const expiry = findSentence(pages, (sentence) => /\blease\b/i.test(sentence) && /\b(expires?|ends?|terminates?)\b/i.test(sentence) && dateIn(sentence) !== null);
    const expires = expiry ? dateIn(expiry.quote) : null;
    if (!expiry || !expires) return [];
    const closing = findSentence(pages, (sentence) => /\b(target|expected|anticipated|scheduled) (closing|completion|close)\b/i.test(sentence) && dateIn(sentence) !== null);
    const billed = evidence.map((row) => (row.evidenceType === INVOICE_LINE ? rowMonth(row) : null)).filter((month): month is string => month !== null).sort().at(-1);
    const from = closing ? dateIn(closing.quote) : billed ? new Date(Date.UTC(Number(billed.slice(0, 4)), Number(billed.slice(5, 7)), 0)).toISOString().slice(0, 10) : null;
    if (!from) return [];
    const left = wholeMonthsBetween(from, expires);
    const renewal = findSentence(pages, (sentence) => /\b(option|right)s? to (renew|extend)\b|\brenewal option\b/i.test(sentence));
    const noRenewal = !renewal || /\b(no|not|without|none)\b/i.test(renewal.quote);
    if (left >= CLINICS_SHORT_LEASE_MONTHS || !noRenewal) return [];
    const assignment = findSentence(pages, (sentence) => /\bassign(ed|ment)?\b/i.test(sentence) && /\blease|landlord\b/i.test(sentence));
    const relocation = findSentence(pages, (sentence) => /\brelocat/i.test(sentence) && moneyIn(sentence) !== null);
    const estimate = relocation ? moneyIn(relocation.quote) : null;
    const after = closing ? 'the target closing date' : 'the latest billed month (no target closing date is stated)';
    const hits = [expiry, closing, renewal, assignment, relocation].filter((hit): hit is NonNullable<typeof hit> => hit !== null);
    return [
      {
        key: `${expires}`,
        domain: 'PROPERTY',
        title: `Clinic lease ends ${left} months after ${closing ? 'closing' : 'the latest billed month'} with no renewal option`,
        description:
          `The lease ends on ${expires}, ${left} months after ${after} (${from}): “${expiry.quote}” ` +
          (renewal ? `On renewal: “${renewal.quote}” ` : 'No renewal or extension option is stated in the documents filed. ') +
          (assignment ? `On assignment: “${assignment.quote}” ` : 'No assignment clause is among the documents filed. ') +
          (estimate ? `The documents put relocation at ${estimate.currency} ${grouped(estimate.amount)}.` : 'No relocation estimate is among the documents filed; the reviewer prices the risk.'),
        severity: left < 18 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Relocation or renegotiation risk: a remediation cost on the bridge, or a lease extension as a closing condition.',
        pricedRisk: estimate
          ? { type: 'REMEDIATION_COST', currency: estimate.currency, low: estimate.amount.div(2).toFixed(2), high: estimate.amount.toFixed(2), basis: 'Half the stated relocation estimate (a renegotiated renewal) to the full estimate (a move).' }
          : null,
        evidenceIds: [],
        quotes: hits.map((hit) => ({ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote })),
      },
    ];
  },
};

/** A clinic's key expense lines in the P&L trend: clinical supplies and lab fees. */
export const CLINICS_PNL_EXPENSES: readonly PnlExpenseLine[] = [
  { key: 'supplies', label: 'Clinical supplies', match: /\bsuppl(y|ies)\b/i },
  { key: 'lab_fees', label: 'Lab fees', match: /\blab(oratory)? (fees|costs?)\b/i },
];

/** The multi-year P&L trend for a clinic (revenue, margins, supplies and lab fees against revenue). */
export const CLINICS_PNL_TREND = pnlTrendRule({ id: 'clinics-pnl-trend', expenses: CLINICS_PNL_EXPENSES });

export const CLINICS_RULES: readonly PackRule[] = [
  CLINICS_PROVIDER_CARRIES_SITE,
  CLINICS_CODING_ABOVE_POLICY,
  CLINICS_EQUIPMENT_PAST_LIFE,
  CLINICS_OWNER_DEPENDENCE,
  CLINICS_REFERRAL_CONCENTRATION,
  CLINICS_LEASE_TERM,
  CLINICS_PNL_TREND,
];
export const CLINICS_EVIDENCE = { VOLUME, EQUIPMENT, CODING, VISITS, SERVICE_LINES } as const;
