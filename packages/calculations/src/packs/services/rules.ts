import { D, parseDecimal } from '../../metrics/decimal';
import { amountOf, latestMonthRevenue, monthName, percent } from '../common';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence } from '../rule-types';

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

export const SERVICES_RULES: readonly PackRule[] = [SERVICES_UTILIZATION_GAP, SERVICES_CLIENT_TERMINATION, SERVICES_DELIVERY_ATTRITION];
export const SERVICES_EVIDENCE = { TIMESHEETS, HEADCOUNT } as const;
