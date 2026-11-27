import { D, parseDecimal } from '../../metrics/decimal';
import type { KeyExpense } from '../../pnl/trend';
import { amountOf, grouped, INVOICE_LINE, latestMonthRevenue, monthName, percent } from '../common';
import { billingCurrency } from '../ecommerce/channels';
import { driverTrendRule, recentRunRule, type DriverSpec, type PackHistorySpec } from '../history';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal } from '../rule-types';
import {
  AGEING_BAND,
  ageingByYear,
  ageingReports,
  BILLING_MONTH,
  billingRows,
  billingYears,
  ceilingClaims,
  coverageFor,
  feeReconciliation,
  practiceModel,
  RAINMAKER_SHARE,
  type CeilingClaim,
} from './practice';

/**
 * IT and professional services pack rules (T-063, spec §19). People data is
 * aggregate only — teams and role families, never individuals (rule 7).
 */
const TIMESHEETS = 'services.timesheet_month';
const HEADCOUNT = 'services.headcount_month';
const monthOf = (row: PackRuleEvidence) => row.canonical['month'] ?? '';
const monthsIn = (rows: readonly PackRuleEvidence[]) => [...new Set(rows.map(monthOf))].filter((month) => /^\d{4}-\d{2}$/.test(month)).sort();
const sum = (rows: readonly PackRuleEvidence[], field: string) => rows.reduce((total, row) => total.plus(amountOf(row, field)), new D(0));

const REPORTED_UTILIZATION = /utili[sz]ation[^:]*:\s*([0-9]+(?:\.[0-9]+)?)%/i;

/** Billable ÷ available hours over the last twelve months, against the utilization management reports. */
export const SERVICES_UTILIZATION_GAP: PackRule = {
  id: 'services-utilization-gap',
  version: '1',
  evidenceTypes: [TIMESHEETS],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = evidence.filter((row) => row.evidenceType === TIMESHEETS);
    const window = monthsIn(rows).slice(-12);
    const hit = findSentence(pages, (sentence) => REPORTED_UTILIZATION.test(sentence));
    const reported = hit ? parseDecimal(REPORTED_UTILIZATION.exec(hit.quote)?.[1] ?? '') : null;
    if (window.length === 0 || !hit || !reported) return [];
    const inWindow = rows.filter((row) => window.includes(monthOf(row)));
    const available = sum(inWindow, 'available_hours');
    if (!available.gt(0)) return [];
    const measured = sum(inWindow, 'billable_hours').div(available);
    const gap = reported.div(100).minus(measured);
    if (gap.lt('0.03')) return [];
    return [
      {
        key: window.at(-1) ?? '',
        domain: 'FINANCIAL',
        title: 'Utilization below the reported level',
        description: `Management reports ${reported.toString()}% utilization; timesheets give ${percent(measured)} billable over ${window.length} months to ${monthName(window.at(-1) ?? '')} — ${gap.times(100).toFixed(1)} points lower. Margin and capacity forecasts built on the reported rate overstate earnings.`,
        severity: gap.gte('0.08') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'An earnings-quality adjustment on people-driven revenue; the reviewer prices it.',
        evidenceIds: inWindow.slice(-MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }],
      },
    ];
  },
};

/** The bare client name, without a trailing "(synthetic)"-style note. */
const bareName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** The largest client can terminate for convenience, under an agreement that names it. */
export const SERVICES_CLIENT_TERMINATION: PackRule = {
  id: 'services-client-termination',
  version: '1',
  evidenceTypes: ['billing.invoice_line'],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const revenue = latestMonthRevenue(evidence);
    const [client, amount] = revenue?.ranked[0] ?? [];
    if (!revenue || !client || !amount) return [];
    const share = amount.div(revenue.total);
    if (share.lt('0.2')) return [];
    const named = new Set(pages.filter((page) => page.text.includes(bareName(client))).map((page) => page.documentId));
    const clause = findSentence(
      pages.filter((page) => named.has(page.documentId)),
      (sentence) => /terminat/i.test(sentence) && /for convenience/i.test(sentence) && /notice/i.test(sentence),
    );
    if (!clause) return [];
    return [
      {
        key: `${clause.page.documentId}:${client}`,
        domain: 'COMMERCIAL',
        title: 'Largest client terminable for convenience',
        description: `${client} is ${percent(share)} of ${monthName(revenue.month)} revenue and its agreement allows termination for convenience: “${clause.quote}”`,
        severity: share.gte('0.3') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Revenue that can leave on short notice; the reviewer prices it or seeks a renewal before closing.',
        evidenceIds: revenue.linesOf([client]).slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: clause.page.documentId, pageNumber: clause.page.pageNumber, quote: clause.quote }],
      },
    ];
  },
};

/** Annualised leavers ÷ average headcount in delivery roles: the last quarter against the first. */
export const SERVICES_DELIVERY_ATTRITION: PackRule = {
  id: 'services-delivery-attrition',
  version: '1',
  evidenceTypes: [HEADCOUNT],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === HEADCOUNT && /deliver/i.test(row.canonical['role_family'] ?? ''));
    const months = monthsIn(rows);
    if (months.length < 6) return [];
    const quarter = (window: readonly string[]) => {
      const inWindow = rows.filter((row) => window.includes(monthOf(row)));
      const headcount = sum(inWindow, 'headcount').div(window.length);
      const leavers = sum(inWindow, 'leavers');
      return { rows: inWindow, leavers, annualised: headcount.gt(0) ? leavers.div(headcount).times(12).div(window.length) : new D(0) };
    };
    const first = quarter(months.slice(0, 3));
    const last = quarter(months.slice(-3));
    if (last.leavers.lt(3) || last.leavers.lt(first.leavers.times(2))) return [];
    const monthly = (month: string) => sum(rows.filter((row) => monthOf(row) === month), 'leavers');
    return [
      {
        key: months.at(-1) ?? '',
        domain: 'PEOPLE',
        title: 'Rising attrition in delivery roles',
        description: `Monthly delivery leavers rose from ${monthly(months[0] ?? '').toString()} in ${monthName(months[0] ?? '')} to ${monthly(months.at(-1) ?? '').toString()} in ${monthName(months.at(-1) ?? '')}; annualised delivery attrition is ${percent(last.annualised)} over the last three months against ${percent(first.annualised)} over the first three (aggregate counts).`,
        severity: last.annualised.gte('0.25') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Delivery capacity and utilization fall with attrition; retention terms or a price adjustment, priced by the reviewer.',
        evidenceIds: [...first.rows, ...last.rows].slice(0, MAX_CITED).map((row) => row.id),
      },
    ];
  },
};


// ---------------------------------------------------------------- realization, concentration, ageing and cover (T-167, ADR 0055)

type Decimal = InstanceType<typeof D>;
const cite = (rows: readonly { id: string }[]) => rows.slice(0, MAX_CITED).map((row) => row.id);
const money = (currency: string | null, value: Decimal) => `${currency ? `${currency} ` : ''}${grouped(value)}`;
const span = (years: readonly { year: string }[]) => (years.length === 1 ? (years[0]?.year ?? '') : `${years[0]?.year ?? ''}–${years.at(-1)?.year ?? ''}`);
const points = (value: Decimal) => `${value.times(100).abs().toFixed(1)} points`;

/** A share this far above a stated ceiling (as a fraction) contradicts it; at or under the ceiling verifies it. */
export const CEILING_TOLERANCE = '0.005';

function ceilingProposal(claim: CeilingClaim, status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED', basis: string, evidenceIds: readonly string[]): PackRuleProposal {
  const quotes = [claim.quote];
  const record = { statement: claim.quote.quote, status, rationale: basis };
  if (status === 'UNVERIFIED')
    return {
      key: `${claim.key}:unverified`,
      domain: 'COMMERCIAL',
      title: `Claim not verified: ${claim.label}`,
      description: `The document states “${claim.quote.quote}” ${basis} Ask the seller for the time-and-billing export behind it before relying on it.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A gap, not a defect: an unverified claim is neither priced nor relied on.',
      evidenceIds: [],
      quotes,
      claim: record,
    };
  if (status === 'VERIFIED')
    return {
      key: `${claim.key}:verified`,
      domain: 'COMMERCIAL',
      title: `Claim verified: ${claim.label}`,
      description: `“${claim.quote.quote}” holds against the export. ${basis}`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${claim.label} verified against the time-and-billing export`, impliedValue: null, basis },
      evidenceIds: evidenceIds.slice(0, MAX_CITED),
      quotes,
      claim: record,
    };
  return {
    key: `${claim.key}:contradicted`,
    domain: 'COMMERCIAL',
    title: `Claim contradicted: ${claim.label}`,
    description: `“${claim.quote.quote}” The export contradicts it. ${basis} More of the fees can leave with one relationship than the deck says; carry the recomputed concentration in the scenarios and price it.`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'The price was set on a concentration the export does not support; the reviewer prices the gap.',
    evidenceIds: evidenceIds.slice(0, MAX_CITED),
    quotes,
    claim: record,
  };
}

/**
 * The concentration claims register (the T-083/T-159 pattern): the ceilings a deck states for any one
 * client and any one partner's book, against fees by client and by relationship partner recomputed from
 * the time-and-billing export over the trailing twelve months — each VERIFIED, CONTRADICTED or UNVERIFIED
 * and recorded in the claims register with its finding.
 */
export const SERVICES_CONCENTRATION_CLAIMS: PackRule = {
  id: 'services-concentration-claims',
  version: '1',
  evidenceTypes: [BILLING_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const model = practiceModel(billingRows(evidence));
    const window = model.trailing;
    return ceilingClaims(pages).flatMap((claim): PackRuleProposal[] => {
      if (!window || window.missing.length || !window.billed.gt(0)) return [ceilingProposal(claim, 'UNVERIFIED', 'The time-and-billing export does not hold twelve complete months of fees.', [])];
      const top = claim.key === 'CLIENT_CEILING' ? model.clients[0] : model.partners[0];
      if (!top?.share) return [ceilingProposal(claim, 'UNVERIFIED', 'The export names no client or partner to measure.', [])];
      const whose = claim.key === 'CLIENT_CEILING' ? `${top.key}, the largest client,` : `${top.key}'s book, the largest partner's (the fees of the clients whose relationship ${top.key} holds),`;
      const basis = `${whose} carried ${percent(top.share)} of the fees billed for ${monthName(window.from)} to ${monthName(window.to)} (${grouped(top.billed)} of ${grouped(window.billed)}), against a stated ceiling of ${percent(claim.ceiling)}, from the time-and-billing export.`;
      if (top.share.lte(claim.ceiling)) return [ceilingProposal(claim, 'VERIFIED', basis, cite(top.rows))];
      if (top.share.minus(claim.ceiling).gt(CEILING_TOLERANCE)) return [ceilingProposal(claim, 'CONTRADICTED', basis, cite(top.rows))];
      return [];
    });
  },
};

/** Realization falling every complete year by this much or more, first to last, is a finding. */
export const REALIZATION_DRIFT = '0.03';

/**
 * Realization by calendar year (fees billed ÷ the standard value of the time worked), falling every year:
 * the defect a single year misses. Collection (cash ÷ fees) is shown beside it. Unpriced: the reviewer
 * carries the latest year's rate into the scenarios.
 */
export const SERVICES_REALIZATION_TREND: PackRule = {
  id: 'services-realization-trend',
  version: '1',
  evidenceTypes: [BILLING_MONTH],
  detect: ({ evidence }) => {
    const years = billingYears(billingRows(evidence)).filter((year) => year.realization !== null);
    if (years.length < 2) return [];
    const rates = years.map((year) => year.realization as Decimal);
    const first = rates[0] as Decimal;
    const last = rates.at(-1) as Decimal;
    const falling = rates.every((rate, index) => index === 0 || rate.lt(rates[index - 1] as Decimal));
    if (!falling || first.minus(last).lt(REALIZATION_DRIFT)) return [];
    const lost = years.at(-1) as (typeof years)[number];
    return [
      {
        key: `${years[0]?.year ?? ''}-${years.at(-1)?.year ?? ''}`,
        domain: 'FINANCIAL',
        title: `Realization falling every year, ${span(years)}`,
        description:
          `Fees billed as a share of the standard value of the time worked fell every year: ${years.map((year, index) => `${year.year} ${percent(rates[index] as Decimal)}${year.collection ? ` (collected ${percent(year.collection)} of fees)` : ''}`).join(', ')}, ${points(first.minus(last))} down, from the time-and-billing export. ` +
          `In ${lost.year} ${grouped(lost.standard.minus(lost.billed))} of time at standard rates was not billed. A single year shows ${percent(last)}, which reads as unremarkable on its own. ` +
          'Each hour earns less than it did: the margin and growth the scenarios assume should carry the latest year, priced by the reviewer.',
        severity: first.minus(last).gte('0.08') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: cite(years.flatMap((year) => year.rows)),
      },
    ];
  },
};

/** An export year's fees and the P&L's revenue differing by more than this share is a finding. */
export const FEE_RECONCILIATION_TOLERANCE = '0.02';

/** Fees recomputed from the time-and-billing export, reconciled to the P&L's revenue year by year. */
export const SERVICES_FEE_RECONCILIATION: PackRule = {
  id: 'services-fee-reconciliation',
  version: '1',
  evidenceTypes: [BILLING_MONTH, PNL_LINE],
  detect: ({ evidence }) =>
    feeReconciliation(evidence).flatMap((year): PackRuleProposal[] => {
      if (!year.relative || year.relative.abs().lte(FEE_RECONCILIATION_TOLERANCE)) return [];
      return [
        {
          key: year.year,
          domain: 'FINANCIAL',
          title: `P&L revenue does not reconcile to the billing export, ${year.year}`,
          description:
            `The imported P&L books ${grouped(year.pnl)} of revenue for ${year.year} (${year.accounts.join(', ')}); the time-and-billing export gives ${grouped(year.exports)} of fees billed for the same twelve months, ` +
            `${grouped(year.difference.abs())} (${percent(year.relative.abs())}) ${year.difference.gt(0) ? 'more in the P&L' : 'less in the P&L'}. Ask the seller to reconcile the two before relying on the revenue line.`,
          severity: year.relative.abs().gt('0.05') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          evidenceIds: [...year.pnlIds, ...cite(year.rows)].slice(0, MAX_CITED),
        },
      ];
    }),
};

/** A ledger's balance over 90 days this many times the year before, or more, is ageing drift. */
export const AGEING_DRIFT_FACTOR = '1.5';
const LEDGER_LABEL: Readonly<Record<string, string>> = { wip: 'WIP', ar: 'Debtors' };

/**
 * WIP and debtor ageing by year, from the ageing reports: a ledger whose balance over 90 days in the latest
 * year is 1.5× or more the year before's. Old WIP is billed late or written off, old debtors are collected
 * late or not at all, so the drift is priced into working capital: low half of the increase, high all of it.
 */
export const SERVICES_AGEING_DRIFT: PackRule = {
  id: 'services-ageing-drift',
  version: '1',
  evidenceTypes: [AGEING_BAND, INVOICE_LINE],
  detect: ({ evidence }) => {
    const currency = billingCurrency(evidence);
    return Object.entries(ageingByYear(ageingReports(evidence))).flatMap(([ledger, years]): PackRuleProposal[] => {
      const last = years.at(-1);
      const prev = years.at(-2);
      if (!last || !prev || !prev.over90.gt(0) || last.over90.lt(prev.over90.times(AGEING_DRIFT_FACTOR))) return [];
      const label = LEDGER_LABEL[ledger] ?? ledger;
      const factor = last.over90.div(prev.over90);
      const increase = last.over90.minus(prev.over90);
      const history = years.map((year) => `${year.asOf} ${money(currency, year.over90)} (${year.over90Share ? percent(year.over90Share) : 'n/a'} of ${money(currency, year.total)})`).join(', ');
      return [
        {
          key: `${ledger}:${prev.asOf}:${last.asOf}`,
          domain: 'FINANCIAL',
          title: `${label} over 90 days up ${factor.toFixed(1)}× in a year, ${prev.year}–${last.year}`,
          description:
            `The ageing reports put the ${label === 'WIP' ? 'unbilled work in progress' : 'billed, unpaid debtors'} older than 90 days at ${history}: ${money(currency, increase)} more in a year, ${factor.toFixed(2)}×. ` +
            `A single report shows a balance that reads as ordinary on its own. Old ${label === 'WIP' ? 'WIP is billed late or written off' : 'debtors are collected late or not at all'}; priced into working capital as a reduction for the reviewer to adjust.`,
          severity: factor.gte(2) ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: currency
            ? { type: 'PRICE_REDUCTION', currency, low: increase.div(2).toFixed(2), high: increase.toFixed(2), basis: `The increase in ${label} older than 90 days, ${prev.asOf} to ${last.asOf} (${money(currency, increase)}): low half of it unrecovered, high all of it.` }
            : null,
          evidenceIds: cite([...last.rows, ...prev.rows]),
        },
      ];
    });
  },
};

/**
 * Covenant cover for the people the fees depend on: every partner whose book (the fees of the clients whose
 * relationship they hold) carries 10% or more of trailing fees, checked against the covenant documents. A
 * rainmaker with no non-compete or non-solicitation on file — none stated, or none in the evidence — is a
 * retention drag. Pseudonymous references only; a record of documents and arithmetic, never an assessment
 * of the person. The check waits until documents have been read, since a document may cover them.
 */
export const SERVICES_RAINMAKER_COVERAGE: PackRule = {
  id: 'services-rainmaker-coverage',
  version: '1',
  evidenceTypes: [BILLING_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const model = practiceModel(billingRows(evidence));
    const window = model.trailing;
    if (!window || window.missing.length || !window.billed.gt(0)) return [];
    return model.partners.flatMap((partner): PackRuleProposal[] => {
      if (!partner.share?.gte(RAINMAKER_SHARE)) return [];
      const cover = coverageFor(pages, partner.key);
      if (cover.state === 'COVERED') return [];
      const clients = new Set(partner.rows.map((row) => row.client)).size;
      const book = model.partnerBasis === 'RELATIONSHIP_PARTNER' ? `${partner.key}'s book — the fees of the ${clients} client${clients === 1 ? '' : 's'} whose relationship ${partner.key} holds —` : `The fees ${partner.key} billed`;
      return [
        {
          key: `${partner.key}:${window.to}`,
          domain: 'PEOPLE',
          title: `Rainmaker with no non-solicit or non-compete on file: ${partner.key}`,
          description:
            `${book} came to ${grouped(partner.billed)} of the ${grouped(window.billed)} billed for ${monthName(window.from)} to ${monthName(window.to)}, ${percent(partner.share)}. ` +
            (cover.state === 'STATED_NONE' && cover.quote ? `The covenant register states there is none: “${cover.quote.quote}” ` : `No covenant document in the evidence names ${partner.key} with a non-compete or non-solicitation covenant. `) +
            'If they leave, the clients may follow. A retention risk recorded from documents and arithmetic, not an assessment of the person: price it (a retention holdback or an earn-out tied to the book staying) or make a signed covenant a closing condition.',
          severity: partner.share.gte('0.25') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          evidenceIds: cite(partner.rows),
          ...(cover.quote ? { quotes: [cover.quote] } : {}),
        },
      ];
    });
  },
};

const ENGAGEMENT_LABEL: Readonly<Record<string, string>> = { retainer: 'retainers', managed_service: 'managed services', project: 'fixed-scope projects', time_and_materials: 'time and materials' };

/** Revenue quality: the recurring and project split of trailing fees, recorded with its rows. */
export const SERVICES_REVENUE_QUALITY: PackRule = {
  id: 'services-revenue-quality',
  version: '1',
  evidenceTypes: [BILLING_MONTH],
  detect: ({ evidence }) => {
    const model = practiceModel(billingRows(evidence));
    const window = model.trailing;
    if (!window || window.missing.length || !model.recurringShare) return [];
    const split = model.byEngagement.map((entry) => `${ENGAGEMENT_LABEL[entry.key] ?? entry.key} ${grouped(entry.billed)} (${entry.share ? percent(entry.share) : 'n/a'})`).join(', ');
    return [
      {
        key: window.to,
        domain: 'FINANCIAL',
        title: `Revenue quality: ${percent(model.recurringShare)} recurring, twelve months to ${monthName(window.to)}`,
        description:
          `Of the ${grouped(window.billed)} billed for ${monthName(window.from)} to ${monthName(window.to)}, ${grouped(model.recurring)} (${percent(model.recurringShare)}) was under retainers or managed services and the rest project work: ${split}. ` +
          'From the time-and-billing export. Recurring fees renew without a new sale; project fees must be won again. Carry the split into the scenarios.',
        severity: 'INFO',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A record of the revenue mix for the scenarios, not a defect.',
        evidenceIds: cite(window.rows),
      },
    ];
  },
};

/** The services key expenses the multi-year P&L trend watches against revenue. */
export const SERVICES_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'staff', label: 'Fee-earner and staff costs', pattern: /\b(?:salar\w*|staff|payroll|fee-?earners?)\b/i },
  { key: 'subcontractors', label: 'Subcontractors and associates', pattern: /\b(?:sub-?contract\w*|contractors?|associates?|freelanc\w*)\b/i },
  { key: 'write_offs', label: 'WIP and bad-debt write-offs', pattern: /\b(?:write-?offs?|written off|bad debts?)\b/i },
  { key: 'recruitment', label: 'Recruitment', pattern: /\brecruit\w*\b/i },
];

export const [SERVICES_PNL_TREND, SERVICES_PNL_MARGIN_DRIFT, SERVICES_PNL_EXPENSE_OUTPACING] = pnlTrendRules('services', SERVICES_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/**
 * Five years of history (T-184b, ADR 0057): the P&L by year, utilization and headcount from the timesheets and
 * realization from the time-and-billing export, by calendar year. Realization falling every year is
 * services-realization-trend's; utilization falling every year is the driver trend below.
 */
export const SERVICES_DRIVERS = {
  utilization: { key: 'utilization', label: 'Utilization', unit: 'RATIO', evidenceType: TIMESHEETS, mode: 'RATIO', numerator: ['billable_hours'], denominator: ['available_hours'], formula: 'Σ billable hours ÷ Σ available hours in the year, every team' },
  realization: { key: 'realization', label: 'Realization', unit: 'RATIO', evidenceType: BILLING_MONTH, mode: 'RATIO', numerator: ['billed'], denominator: ['standard_value'], formula: 'Σ fees billed ÷ Σ standard value of the time worked in the year' },
  headcount: { key: 'headcount', label: 'Headcount (December)', unit: 'COUNT', evidenceType: TIMESHEETS, mode: 'LAST', numerator: ['headcount'], formula: 'Σ headcount across the teams in the year\'s last month' },
} as const satisfies Record<string, DriverSpec>;

export const SERVICES_HISTORY: PackHistorySpec = {
  drivers: [SERVICES_DRIVERS.utilization, SERVICES_DRIVERS.realization, SERVICES_DRIVERS.headcount],
  keyExpenses: SERVICES_KEY_EXPENSES,
  driverImport: ['SERVICES_TIMESHEETS', 'SERVICES_TIME_BILLING'],
  driverLabel: 'Timesheets and billing',
  driverWhat: 'timesheet and time-and-billing history',
};

/** Utilization falling every year by this much or more, first year to last (3 points). */
export const UTILIZATION_DECLINE_POINTS = '0.03';

export const SERVICES_UTILIZATION_TREND = driverTrendRule(
  {
    id: 'services-utilization-trend',
    driver: SERVICES_DRIVERS.utilization,
    adverse: 'DOWN',
    threshold: UTILIZATION_DECLINE_POINTS,
    domain: 'FINANCIAL',
    advice: 'Fewer of the hours available are billed each year: check the bench, the pipeline and hiring ahead of demand before carrying today\'s utilization into the scenarios.',
  },
  SERVICES_HISTORY,
);

export const SERVICES_RULES: readonly PackRule[] = [
  SERVICES_UTILIZATION_GAP,
  SERVICES_CLIENT_TERMINATION,
  SERVICES_DELIVERY_ATTRITION,
  SERVICES_CONCENTRATION_CLAIMS,
  SERVICES_REALIZATION_TREND,
  SERVICES_FEE_RECONCILIATION,
  SERVICES_AGEING_DRIFT,
  SERVICES_RAINMAKER_COVERAGE,
  SERVICES_REVENUE_QUALITY,
  SERVICES_PNL_TREND,
  SERVICES_PNL_MARGIN_DRIFT,
  SERVICES_PNL_EXPENSE_OUTPACING,
  SERVICES_UTILIZATION_TREND,
  // The recent run against the long run (T-185): quiet until ten years or more are read.
  recentRunRule('services', SERVICES_HISTORY),
];
export const SERVICES_EVIDENCE = { TIMESHEETS, HEADCOUNT, BILLING_MONTH, AGEING_BAND } as const;
