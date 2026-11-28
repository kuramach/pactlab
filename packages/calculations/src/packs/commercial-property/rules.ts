import { D } from '../../metrics/decimal';
import { pnlPeriods } from '../../pnl/pnl';
import { fiscalYears, pnlLinesFromRecords } from '../../pnl/trend';
import { wholeMonths } from '../clinics/practice';
import { amountOf, documentClauseRule, grouped, INVOICE_LINE, latestMonthRevenue, monthName, percent } from '../common';
import { driverTrendRule, recentRunRule, type DriverSpec, type PackHistorySpec } from '../history';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  anniversariesBy,
  CAPEX_ITEM,
  capexSchedule,
  conditionChecks,
  creAnalysisDate,
  creHoldWindow,
  CRE_KEY_EXPENSES,
  DOMINANT_TENANT_SHARE,
  EARLY_HOLD_YEARS,
  expiryProfile,
  holdYearOf,
  leaseReadings,
  obligations,
  persistentShortfall,
  RECOVERY_TREND_MIN_YEARS,
  recoverableShare,
  recoveryYears,
  rentChecks,
  rentRoll,
  STATEMENT_RENT_TOLERANCE,
  statementRent,
  tenantShares,
  type CreLeaseReading,
} from './leases';

/**
 * Commercial property pack rules (T-066, spec §19). Tenants are businesses;
 * the rent roll is lease data, never people data.
 */
const LEASE = 'cre.lease';
const CAM = 'cre.cam_category';
type Decimal = InstanceType<typeof D>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const dayNumber = (date: string) => {
  const match = DATE.exec(date);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000 : null;
};
/** The last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const bareName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim();
const leases = (evidence: readonly PackRuleEvidence[]) => evidence.filter((row) => row.evidenceType === LEASE && dayNumber(row.canonical['lease_end'] ?? '') !== null);
const rentOf = (row: PackRuleEvidence) => amountOf(row, 'monthly_base_rent');
const largestLease = (rows: readonly PackRuleEvidence[]) => [...rows].sort((a, b) => rentOf(b).comparedTo(rentOf(a)) || (a.canonical['suite'] ?? '').localeCompare(b.canonical['suite'] ?? ''))[0];

/**
 * The anchor tenant carries a large share of base rent and its lease ends
 * within two years of the latest billed month; the lease abstract that names
 * the tenant confirms the term. Reports the rent-weighted average lease term.
 */
export const CRE_ANCHOR_ROLLOVER: PackRule = {
  id: 'cre-anchor-rollover',
  version: '1',
  evidenceTypes: [LEASE, 'billing.invoice_line'],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = leases(evidence);
    const revenue = latestMonthRevenue(evidence);
    const anchor = largestLease(rows);
    if (!revenue || !anchor) return [];
    const asOf = monthEnd(revenue.month);
    const today = dayNumber(asOf) ?? 0;
    const total = rows.reduce((sum, row) => sum.plus(rentOf(row)), new D(0));
    if (!total.gt(0)) return [];
    const share = rentOf(anchor).div(total);
    const remaining = (row: PackRuleEvidence) => D.max(0, new D((dayNumber(row.canonical['lease_end'] ?? '') ?? today) - today).div('365.25'));
    const walt = rows.reduce((sum, row) => sum.plus(rentOf(row).times(remaining(row))), new D(0)).div(total);
    if (share.lt('0.3') || remaining(anchor).gt(2)) return [];
    const tenant = anchor.canonical['tenant'] ?? '';
    const named = new Set(pages.filter((page) => page.text.includes(bareName(tenant))).map((page) => page.documentId));
    const term = findSentence(
      pages.filter((page) => named.has(page.documentId)),
      (sentence) => /\b(term|lease) (ends|expires)\b/i.test(sentence),
    );
    if (!term) return [];
    return [
      {
        key: `${anchor.canonical['suite']}:${anchor.canonical['lease_end']}`,
        domain: 'PROPERTY',
        title: 'Anchor tenant concentration and near-term expiry',
        description: `${tenant} is ${percent(share)} of base rent and its lease ends ${anchor.canonical['lease_end']} (${remaining(anchor).toFixed(1)} years after ${asOf}). Weighted average lease term is ${walt.toFixed(1)} years. The lease abstract: “${term.quote}”`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Rollover risk on the largest lease: the rollover schedule and cap rate follow; the reviewer prices it or makes renewal a condition.',
        evidenceIds: rows.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: term.page.documentId, pageNumber: term.page.pageNumber, quote: term.quote }],
      },
    ];
  },
};

export const CRE_ENVIRONMENTAL_CONDITION = documentClauseRule({
  id: 'cre-environmental-condition',
  title: 'Recognized environmental condition',
  domain: 'PROPERTY',
  severity: 'HIGH',
  direction: -1,
  directionRationale: 'Remediation cost is unknown until the Phase II; an escrow or indemnity the reviewer prices.',
  sentences: [(sentence) => /recogni[sz]ed environmental condition/i.test(sentence), (sentence) => /phase ii/i.test(sentence)],
  description: ([condition, next]) => `The Phase I environmental site assessment identifies a recognized environmental condition: “${condition}” “${next}”`,
});

/** CAM categories that recover less from tenants than they cost, in the latest reconciliation year. */
export const CRE_CAM_UNDER_RECOVERY: PackRule = {
  id: 'cre-cam-under-recovery',
  version: '1',
  evidenceTypes: [CAM],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === CAM && /^\d{4}$/.test(row.canonical['year'] ?? ''));
    const year = rows.map((row) => row.canonical['year'] ?? '').sort().at(-1);
    const inYear = rows.filter((row) => row.canonical['year'] === year);
    const short = inYear.filter((row) => amountOf(row, 'recoveries').lt(amountOf(row, 'expenses')));
    const expenses = inYear.reduce((sum, row) => sum.plus(amountOf(row, 'expenses')), new D(0));
    const gap = short.reduce((sum: Decimal, row) => sum.plus(amountOf(row, 'expenses').minus(amountOf(row, 'recoveries'))), new D(0));
    if (!year || short.length === 0 || !expenses.gt(0) || gap.div(expenses).lt('0.02')) return [];
    return [
      {
        key: year,
        domain: 'PROPERTY',
        title: 'CAM recoveries below expenses',
        description: `In ${year}, ${short.map((row) => `${row.canonical['category']} (${grouped(amountOf(row, 'expenses'))} spent, ${grouped(amountOf(row, 'recoveries'))} recovered)`).join(' and ')} recovered less than they cost: ${grouped(gap)} a year in the deal's currency, ${percent(gap.div(expenses))} of CAM expenses, comes out of NOI.`,
        severity: gap.div(expenses).gte('0.1') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'NOI should carry the unrecovered CAM; at the cap rate that is a price adjustment the reviewer sets.',
        evidenceIds: short.map((row) => row.id),
      },
    ];
  },
};

/**
 * The largest lease pays the deepest discount to market rent on the roll.
 * Upside the buyer confirms on renewal — never a reason to pay more.
 */
export const CRE_BELOW_MARKET_ANCHOR: PackRule = {
  id: 'cre-below-market-anchor',
  version: '1',
  evidenceTypes: [LEASE],
  detect: ({ evidence }) => {
    const rows = leases(evidence).filter((row) => amountOf(row, 'monthly_market_rent').gt(0));
    const anchor = largestLease(rows);
    if (!anchor) return [];
    const discount = (row: PackRuleEvidence) => new D(1).minus(rentOf(row).div(amountOf(row, 'monthly_market_rent')));
    const deepest = D.max(...rows.map(discount));
    if (discount(anchor).lt('0.03') || discount(anchor).lt(deepest)) return [];
    const yearly = amountOf(anchor, 'monthly_market_rent').minus(rentOf(anchor)).times(12);
    const tenant = anchor.canonical['tenant'] ?? '';
    return [
      {
        key: `${anchor.canonical['suite']}`,
        domain: 'PROPERTY',
        title: 'Below-market anchor rent (upside, not price)',
        description: `${tenant} pays ${percent(discount(anchor))} below market rent — the deepest discount on the rent roll, on the largest lease: ${grouped(yearly)} a year in the deal's currency if it resets to market. Confirmed value — never a reason to pay more.`,
        severity: 'LOW',
        confidence: 'MEDIUM',
        direction: 1,
        valueConfirmation: {
          valueDriver: 'Below-market anchor rent',
          impliedValue: null,
          basis: `Rent roll: ${tenant} base rent ${grouped(rentOf(anchor))} a month against market ${grouped(amountOf(anchor, 'monthly_market_rent'))}.`,
        },
        evidenceIds: [anchor.id],
      },
    ];
  },
};

// ---------------------------------------------------------------- rent roll against the leases, recoveries, obligations, the cliff and condition (T-165, ADR 0068)

const cite = (ids: readonly string[]) => [...new Set(ids)].slice(0, MAX_CITED);
const quotesOf = (quotes: readonly (PackRuleQuote | null | undefined)[]) => quotes.filter((quote): quote is PackRuleQuote => Boolean(quote)).slice(0, MAX_CITED);
const longDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return `${Number(day)} ${monthName(`${year}-${month}`)}`;
};
const span = (years: readonly { year: string }[]) => (years.length === 1 ? (years[0]?.year ?? '') : `${years[0]?.year ?? ''}–${years.at(-1)?.year ?? ''}`);
const rollTenants = (evidence: readonly PackRuleEvidence[]) => rentRoll(evidence).map((entry) => entry.tenant);
const money2 = (value: Decimal) => value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Rent-roll verification: every suite's rent recomputed from its lease — the initial base rent stepped up by the
 * lease's escalation on each anniversary reached by the analysis date — against the rent roll; and every fiscal
 * year of the imported P&L against the rent the leases make due in it. A rent roll above the leases overstates
 * NOI (−1); statements above the leases likewise. A tenant with no lease on file, or a roll expiry the lease does
 * not give, is recorded for the reviewer (0). The leases govern, so the check waits until documents are read.
 */
export const CRE_RENT_ROLL_VERIFICATION: PackRule = {
  id: 'cre-rent-roll-verification',
  version: '1',
  evidenceTypes: [LEASE, INVOICE_LINE, PNL_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const asOf = creAnalysisDate(evidence);
    if (pages.length === 0 || !asOf || !evidence.some((row) => row.evidenceType === LEASE)) return [];
    const checks = rentChecks(evidence, pages, asOf);
    const statements = statementRent(evidence, checks);
    const latest = statements.at(-1);
    const statementLine = latest
      ? ` The FY${latest.year} statements carry ${grouped(latest.statements)} of base rental income; the leases on file make ${grouped(latest.leases)} due in the year${latest.gap.abs().lt(1) ? ', so the statements follow the leases' : ` (${latest.gap.gte(0) ? '+' : '−'}${grouped(latest.gap.abs())})`}.`
      : '';
    const out: PackRuleProposal[] = [];
    const over = checks.filter((check) => check.state === 'OVERSTATED');
    if (over.length) {
      const monthly = over.reduce((total, check) => total.plus(check.gap as Decimal), new D(0));
      const rollAnnual = checks.reduce((total, check) => total.plus(check.roll.monthlyRent), new D(0)).times(12);
      out.push({
        key: `overstated:${asOf}:${over.map((check) => check.roll.suite).join(',')}`,
        domain: 'PROPERTY',
        title: `Rent roll overstates rent against the leases: ${over.length} tenant${over.length === 1 ? '' : 's'}`,
        description:
          over
            .map((check) => {
              const lease = check.lease as CreLeaseReading;
              const steps = lease.start ? anniversariesBy(lease.start, asOf) : 0;
              const basis = lease.escalation?.isZero() ? 'fixed for the term' : `${grouped(lease.initialRent ?? new D(0))} from ${longDate(lease.start ?? asOf)}, up ${percent(lease.escalation ?? new D(0))} on each of ${steps} anniversar${steps === 1 ? 'y' : 'ies'}`;
              return `${check.roll.tenant}, ${check.roll.suite}: the rent roll says ${money2(check.roll.monthlyRent)} a month; the lease makes ${money2(check.leaseRent as Decimal)} due on ${longDate(asOf)} (${basis}), ${money2(check.gap as Decimal)} a month over`;
            })
            .join('. ') +
          `. Together the rent roll carries ${grouped(monthly.times(12))} a year more than the leases, ${percent(monthly.times(12).div(rollAnnual))} of in-place rent.${statementLine} Carry the leases’ rent in NOI, not the rent roll’s.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'NOI on the rent roll is overstated against the leases; at the cap rate that is a price adjustment the reviewer sets.',
        evidenceIds: cite([...over.map((check) => check.roll.row.id), ...(latest?.evidenceIds ?? [])]),
        quotes: quotesOf(over.flatMap((check) => [check.lease?.rentQuote, check.lease?.escalationQuote])),
      });
    }
    const high = statements.filter((year) => year.gap.gt(0) && (year.share?.gt(STATEMENT_RENT_TOLERANCE) ?? false));
    if (high.length)
      out.push({
        key: `statements:${high.map((year) => year.year).join(',')}`,
        domain: 'FINANCIAL',
        title: `Rental income in the statements exceeds the leases, FY${span(high)}`,
        description: `${high.map((year) => `FY${year.year}: ${grouped(year.statements)} of base rental income against ${grouped(year.leases)} the leases on file make due (${percent(year.share ?? new D(0))} over)`).join('; ')}. Ask the seller what the rest is before relying on the statements’ rent.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Income the leases do not support: the reviewer normalises NOI to the leases and prices the gap.',
        evidenceIds: cite(high.flatMap((year) => year.evidenceIds)),
      });
    const missing = checks.filter((check) => check.state === 'NO_LEASE' || check.state === 'NOT_COMPUTABLE');
    if (missing.length)
      out.push({
        key: `missing:${missing.map((check) => check.roll.suite).join(',')}`,
        domain: 'PROPERTY',
        title: `${missing.length} rent-roll tenant${missing.length === 1 ? ' has' : 's have'} no lease that states the rent`,
        description: `${missing.map((check) => `${check.roll.tenant}, ${check.roll.suite}: ${check.state === 'NO_LEASE' ? 'no lease agreement on file' : 'the lease on file does not state the initial rent, the commencement date and the escalation'}`).join('; ')}. Absence is shown as absence: ask the seller for the leases before relying on these rents.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A gap in the lease file to close, not a price term until the lease is read.',
        evidenceIds: cite(missing.map((check) => check.roll.row.id)),
      });
    const differs = checks.filter((check) => check.expiryDiffers);
    if (differs.length)
      out.push({
        key: `expiry:${differs.map((check) => `${check.roll.suite}-${check.lease?.end}`).join(',')}`,
        domain: 'PROPERTY',
        title: `Rent roll expiry dates differ from the leases: ${differs.length} tenant${differs.length === 1 ? '' : 's'}`,
        description: `${differs.map((check) => `${check.roll.tenant}: the rent roll says ${check.roll.end}, the lease’s term runs to ${check.lease?.end}`).join('; ')}. The lease governs: the expiry profile and the rollover schedule should follow it.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A correction to the rent roll; the expiry checks read the lease.',
        evidenceIds: cite(differs.map((check) => check.roll.row.id)),
        quotes: quotesOf(differs.map((check) => check.lease?.termQuote)),
      });
    return out;
  },
};

/**
 * Recovery reconciliation: by statement year, NNN and CAM recoveries billed (the CAM reconciliation) against what
 * the leases make recoverable — the year's recoverable pool × the triple-net tenants' proportionate shares the
 * leases state. A shortfall of 2% or more in every one of three or more consecutive years is a persistent leak a
 * single year’s view would call noise (−1). The P&L’s recovery line is shown beside each year.
 */
export const CRE_RECOVERY_RECONCILIATION: PackRule = {
  id: 'cre-recovery-reconciliation',
  version: '1',
  evidenceTypes: [CAM, LEASE, PNL_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const leases = leaseReadings(pages, rollTenants(evidence));
    const { share, leases: nnn } = recoverableShare(leases);
    if (nnn.length === 0) return [];
    const run = persistentShortfall(recoveryYears(evidence, share));
    if (run.length < RECOVERY_TREND_MIN_YEARS) return [];
    const { years } = fiscalYears(pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE))));
    const pnlRecoveries = (year: string) => {
      const rows = years.find((entry) => entry.period === year)?.sources.filter((row) => row.kind === 'REVENUE' && /\brecover/i.test(row.account)) ?? [];
      return rows.length ? rows.reduce((total, row) => total.plus(row.amount), new D(0)) : null;
    };
    const total = run.reduce((sum, year) => sum.plus(year.shortfall as Decimal), new D(0));
    const last = run.at(-1) as (typeof run)[number];
    return [
      {
        key: `${span(run)}:${share.toFixed(4)}`,
        domain: 'PROPERTY',
        title: `NNN recoveries short of the leases in every year, ${span(run)}`,
        description:
          `The leases on file make ${nnn.length} tenant${nnn.length === 1 ? '' : 's'} triple net, with proportionate shares summing to ${percent(share)} of the recoverable expenses. ` +
          run
            .map((year) => {
              const pnl = pnlRecoveries(year.year);
              return `${year.year}: ${grouped(year.pool)} recoverable expenses, ${grouped(year.recoverable as Decimal)} recoverable under the leases, ${grouped(year.billed)} billed${pnl ? ` (the P&L carries ${grouped(pnl)})` : ''}, ${grouped(year.shortfall as Decimal)} short (${percent(year.shortfallShare as Decimal)})`;
            })
            .join('; ') +
          `. ${grouped(total)} unrecovered over ${run.length} years: a persistent leak out of NOI, not a one-year timing difference. Normalise NOI to the leases’ recoveries, or price the leak and ask the seller why the reconciliations under-bill.`,
        severity: (last.shortfallShare as Decimal).gte('0.05') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'NOI carries expenses the leases let the landlord recover and it did not: the reviewer prices the leak at the cap rate.',
        evidenceIds: cite(run.flatMap((year) => year.evidenceIds)),
        quotes: quotesOf(nnn.map((lease) => lease.recoveryQuote)),
      },
    ];
  },
};

/**
 * The obligations register: tenant improvement allowances and leasing commissions the leases say the landlord
 * still owes, and the committed lines of the seller's capex schedule. The buyer inherits them at closing, so
 * they are priced into the bridge as a price reduction at their sum (−1). Waits for the leases.
 */
export const CRE_OBLIGATIONS: PackRule = {
  id: 'cre-obligations',
  version: '1',
  evidenceTypes: [LEASE, CAPEX_ITEM, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const list = obligations(evidence, pages);
    if (list.length === 0) return [];
    const base = latestMonthRevenue(evidence)?.currency ?? null;
    const currencies = new Set(list.map((entry) => entry.currency ?? base));
    const currency = currencies.size === 1 ? ([...currencies][0] ?? null) : null;
    const total = list.reduce((sum, entry) => sum.plus(entry.amount), new D(0));
    return [
      {
        key: list.map((entry) => `${entry.kind}:${entry.amount.toFixed(2)}`).join(','),
        domain: 'PROPERTY',
        title: 'Landlord obligations the buyer inherits: tenant improvements, leasing commissions and committed capex',
        description:
          `${list.map((entry) => `${entry.label}: ${grouped(entry.amount)}`).join('; ')}. ` +
          `${grouped(total)} in all${currency ? ` (${currency})` : ''}, from the leases’ own sentences and the committed lines of the seller’s capex schedule. Price it as a credit at closing, or have the seller settle it before.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: currency ? { type: 'PRICE_REDUCTION', currency, low: total.toFixed(2), high: total.toFixed(2), basis: 'Unpaid tenant improvements and leasing commissions the leases state, and committed capex on the seller’s schedule.' } : null,
        directionRationale: 'Cash the buyer pays after closing for obligations the seller incurred: a price reduction at their sum.',
        evidenceIds: cite([...list.flatMap((entry) => (entry.evidenceId ? [entry.evidenceId] : [])), ...rentRoll(evidence).map((entry) => entry.row.id)]),
        quotes: quotesOf(list.map((entry) => entry.quote)),
      },
    ];
  },
};

/**
 * Concentration and the expiry cliff: rent share by tenant from the rent roll, and the share of rent expiring in
 * each year of the hold — measured from the expected closing a document states (else the analysis date), for the
 * hold a document states (else five years); a lease's own term governs its end date. A dominant tenant (25% of
 * rent or more) whose lease ends before the closing or in the first two years of the hold is a cliff (−1).
 */
export const CRE_RENT_CLIFF: PackRule = {
  id: 'cre-rent-cliff',
  version: '1',
  evidenceTypes: [LEASE, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const hold = creHoldWindow(evidence, pages);
    const { shares } = tenantShares(evidence);
    const top = shares[0];
    if (!hold || !top || top.share.lt(DOMINANT_TENANT_SHARE)) return [];
    const lease = leaseReadings(pages, shares.map((entry) => entry.entry.tenant)).find((reading) => reading.tenant === top.entry.tenant) ?? null;
    const end = lease?.end ?? top.entry.end;
    if (!end) return [];
    const year = holdYearOf(end, hold);
    if (year > EARLY_HOLD_YEARS) return [];
    const profile = expiryProfile(evidence, hold).filter((bucket) => bucket.share.gt(0));
    const months = end < hold.from ? null : wholeMonths(hold.from, end);
    const measured = hold.basis === 'EXPECTED_CLOSING' ? `the expected closing on ${longDate(hold.from)}` : `${longDate(hold.from)}, the end of the latest billed month (no closing date is stated)`;
    const when = year === 0 ? 'before the closing' : `in year ${year} of the hold`;
    return [
      {
        key: `${top.entry.suite}:${end}:${hold.from}:${hold.years}`,
        domain: 'PROPERTY',
        title: `Rent cliff: ${top.entry.tenant} (${percent(top.share)} of rent) expires ${when}`,
        description:
          `${top.entry.tenant} pays ${percent(top.share)} of base rent on the rent roll, and its lease ends on ${longDate(end)} (${lease?.end ? 'as the lease states' : 'from the rent roll'}), ${months === null ? 'before the closing' : `${months} month${months === 1 ? '' : 's'} after ${measured}`}. ` +
          `Share of rent expiring over the ${hold.years}-year hold${hold.yearsStated ? ' the documents state' : ' (none is stated; five years assumed)'}: ${profile.map((bucket) => `${bucket.label} ${percent(bucket.share)}`).join(', ')}. ` +
          'A vacancy here removes that share of income early in ownership: carry the renewal probability, downtime, leasing costs and re-letting rent in the scenarios, or make a renewal a closing condition. Documents and arithmetic only; no view on whether the tenant renews.',
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Income concentrated in one lease that ends early in the hold: a rollover assumption the reviewer sets in the scenarios.',
        evidenceIds: cite(shares.map((entry) => entry.entry.row.id)),
        quotes: quotesOf([lease?.termQuote, hold.closingQuote]),
      },
    ];
  },
};

/**
 * Condition evidence: items a property condition assessment or environmental report flags with an estimated cost,
 * by building element, against the seller's capex schedule. An item the schedule omits is a drag priced as
 * remediation at the report's estimate; one the schedule budgets below 90% of it is priced at the difference.
 * Nothing is drafted until the schedule is imported and the reports are read.
 */
export const CRE_CONDITION_CAPEX: PackRule = {
  id: 'cre-condition-capex',
  version: '1',
  evidenceTypes: [CAPEX_ITEM],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0 || !evidence.some((row) => row.evidenceType === CAPEX_ITEM)) return [];
    return conditionChecks(evidence, pages).flatMap((check): PackRuleProposal[] => {
      if (check.state === 'COVERED') return [];
      const { item } = check;
      const omitted = check.state === 'OMITTED';
      const gap = omitted ? item.amount : item.amount.minus(check.scheduledAmount);
      return [
        {
          key: `${item.element.key}:${check.state.toLowerCase()}:${item.amount.toFixed(2)}`,
          domain: 'PROPERTY',
          title: omitted ? `${item.element.label} work flagged by the condition report is not in the seller’s capex schedule` : `${item.element.label} work under-budgeted in the seller’s capex schedule`,
          description:
            `The condition report says: “${item.quote.quote}” ` +
            (omitted
              ? 'The seller’s capex schedule has no line for it. '
              : `The schedule carries ${grouped(check.scheduledAmount)} for it (${check.scheduled.map((line) => `${line.item}, ${line.year}`).join('; ')}), ${grouped(gap)} short of the estimate. `) +
            'The buyer funds it after closing: price it into the bridge as remediation, or have the seller complete it before closing.',
          severity: omitted && gap.gte(new D(500000)) ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: { type: 'REMEDIATION_COST', currency: item.currency, low: gap.toFixed(2), high: gap.toFixed(2), basis: omitted ? 'The condition report’s estimate for work the capex schedule omits.' : 'The condition report’s estimate less what the capex schedule budgets.' },
          directionRationale: 'Capital work the evidence says is due and the seller’s schedule does not fund: a remediation cost on the bridge.',
          evidenceIds: cite(check.scheduled.length ? check.scheduled.map((line) => line.row.id) : capexSchedule(evidence).map((line) => line.row.id)),
          quotes: [item.quote],
        },
      ];
    });
  },
};

export const [CRE_PNL_TREND, CRE_PNL_MARGIN_DRIFT, CRE_PNL_EXPENSE_OUTPACING] = pnlTrendRules('cre', CRE_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/** Leasing history by month (T-184c): rentable and leased area, base rent in force and area expiring. */
export const LEASING_MONTH = 'cre.leasing_month';

/**
 * Five years of history (ADR 0057, T-184c): the P&L by year beside occupancy, rent per square foot and lease
 * expiries from the leasing history, and the recovery ratio the CAM reconciliations give. The multifamily
 * occupancy reader counts units; a commercial park lets square feet, so the drivers here read area.
 */
export const CRE_DRIVERS = {
  occupancy: {
    key: 'occupancy',
    label: 'Occupancy (leased ÷ rentable area)',
    unit: 'RATIO',
    evidenceType: LEASING_MONTH,
    mode: 'RATIO',
    numerator: ['leased_sqft'],
    denominator: ['rentable_sqft'],
    formula: 'Σ leased square feet ÷ Σ rentable square feet over the year’s months (the average occupancy)',
  },
  rentPerSqft: {
    key: 'rent_per_sqft',
    label: 'Base rent per leased sq ft (a year)',
    unit: 'MONEY',
    evidenceType: LEASING_MONTH,
    mode: 'RATIO',
    numerator: ['base_rent'],
    denominator: ['leased_sqft'],
    multiplier: '12',
    formula: 'Σ base rent in force ÷ Σ leased square feet over the year’s months, × 12',
  },
  expiries: {
    key: 'expiring_sqft',
    label: 'Leased area expiring (sq ft)',
    unit: 'COUNT',
    evidenceType: LEASING_MONTH,
    mode: 'SUM',
    numerator: ['expiring_sqft'],
    formula: 'Σ square feet whose lease ended in the year, renewed or not',
  },
  recoveryRatio: {
    key: 'recovery_ratio',
    label: 'Recoveries billed ÷ recoverable expenses',
    unit: 'RATIO',
    evidenceType: CAM,
    mode: 'RATIO',
    numerator: ['recoveries'],
    denominator: ['expenses'],
    formula: 'Σ recoveries billed ÷ Σ recoverable expenses, from the year’s CAM reconciliation',
    compute: (evidence) =>
      recoveryYears(evidence, null).map((year) => ({ year: year.year, value: year.pool.gt(0) ? year.billed.div(year.pool).toFixed(4) : null, evidenceIds: year.evidenceIds })),
  },
} as const satisfies Record<string, DriverSpec>;

export const CRE_HISTORY: PackHistorySpec = {
  drivers: [CRE_DRIVERS.occupancy, CRE_DRIVERS.rentPerSqft, CRE_DRIVERS.expiries, CRE_DRIVERS.recoveryRatio],
  keyExpenses: CRE_KEY_EXPENSES,
  driverImport: ['CRE_LEASING_HISTORY', 'CRE_CAM_RECONCILIATION'],
  driverLabel: 'Leasing history and CAM reconciliations',
  driverWhat: 'leasing history and CAM reconciliations',
  keyDriver: 'occupancy',
};

/** Average occupancy down every year by this much or more, first year to last (3 points). */
export const OCCUPANCY_DECLINE_POINTS = '0.03';

export const CRE_OCCUPANCY_TREND = driverTrendRule(
  {
    id: 'cre-occupancy-trend',
    driver: CRE_DRIVERS.occupancy,
    adverse: 'DOWN',
    threshold: OCCUPANCY_DECLINE_POINTS,
    domain: 'PROPERTY',
    advice: 'Space is being given back faster than it is let: check which tenants left, the re-letting time and incentives, and whether the scenarios carry today’s occupancy or a lower one.',
  },
  CRE_HISTORY,
);

export const COMMERCIAL_PROPERTY_RULES: readonly PackRule[] = [
  CRE_ANCHOR_ROLLOVER,
  CRE_ENVIRONMENTAL_CONDITION,
  CRE_CAM_UNDER_RECOVERY,
  CRE_BELOW_MARKET_ANCHOR,
  CRE_RENT_ROLL_VERIFICATION,
  CRE_RECOVERY_RECONCILIATION,
  CRE_OBLIGATIONS,
  CRE_RENT_CLIFF,
  CRE_CONDITION_CAPEX,
  CRE_PNL_TREND,
  CRE_PNL_MARGIN_DRIFT,
  CRE_PNL_EXPENSE_OUTPACING,
  CRE_OCCUPANCY_TREND,
  // The recent run against the long run (T-185): quiet until ten years or more are read.
  recentRunRule('cre', CRE_HISTORY),
];
export const COMMERCIAL_PROPERTY_EVIDENCE = { LEASE, CAM, CAPEX_ITEM, LEASING_MONTH } as const;
