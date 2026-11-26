import { D } from '../../metrics/decimal';
import type { KeyExpense } from '../../pnl/trend';
import { amountOf, documentClauseRule, grouped, INVOICE_LINE, latestMonthRevenue, percent } from '../common';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  capexSchedule,
  conditionItems,
  CRE_CAPEX,
  CRE_CLIFF_SHARE,
  CRE_CLIFF_YEARS,
  CRE_STATEMENT_TOLERANCE,
  obligations,
  recoveryYears,
  rentChecks,
  statementRent,
  tenantRents,
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


// ------------------------------------------------------------------ T-165: the rent roll against the leases, recoveries and expiry cliffs

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2027-06-30" → "30 June 2027". */
const longDate = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''} ${date.slice(0, 4)}`;
const cash = (value: Decimal) => {
  const [whole = '0', fraction = '00'] = value.abs().toFixed(2).split('.');
  return `${value.isNegative() ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
};
const money = (currency: string | null, value: Decimal) => `${currency ? `${currency} ` : ''}${grouped(value)}`;
const span = (years: readonly string[]) => (years.length === 1 ? years[0] ?? '' : `${years[0] ?? ''}–${years.at(-1) ?? ''}`);
const billingCurrency = (evidence: readonly PackRuleEvidence[]) => {
  const currencies = new Set(evidence.filter((row) => row.evidenceType === INVOICE_LINE).map((row) => (row.canonical['currency'] ?? '').trim()).filter(Boolean));
  return currencies.size === 1 ? ([...currencies][0] ?? null) : null;
};
const quotes = (...items: readonly (PackRuleQuote | null | undefined)[]) => items.filter((item): item is PackRuleQuote => Boolean(item)).slice(0, MAX_CITED);

/**
 * Rent, escalations and expiries recomputed lease by lease and set against the rent roll: a roll above the
 * lease is an overstatement (−1, NOI and so the price follow it); a roll expiry the lease contradicts is a
 * mismatch (−1). The lease governs. Waits for the leases: without them nothing can be checked.
 */
export const CRE_RENT_ROLL_VERIFICATION: PackRule = {
  id: 'cre-rent-roll-verification',
  version: '1',
  evidenceTypes: [LEASE, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const { asOf, checks } = rentChecks(evidence, pages);
    if (!asOf) return [];
    const out: PackRuleProposal[] = [];
    for (const check of checks) {
      const lease = check.lease;
      if (!lease) continue;
      if (check.state === 'OVERSTATED' && check.leaseRent && check.difference && check.relative) {
        const escalation = lease.escalation?.gt(0) ? `raised ${percent(lease.escalation)} on each anniversary of ${longDate(lease.commencement ?? '')} (${check.escalations} increase${check.escalations === 1 ? '' : 's'} by ${longDate(asOf)})` : 'fixed for the term';
        out.push({
          key: `rent:${check.row.suite}:${check.row.rent.toFixed(2)}:${check.leaseRent.toFixed(2)}`,
          domain: 'PROPERTY',
          title: `Rent roll overstates rent: ${check.row.tenant}`,
          description:
            `The rent roll shows ${money(lease.currency, check.row.rent)} a month for ${check.row.tenant} (${check.row.suite}); the lease gives ${lease.currency ?? ''} ${cash(check.leaseRent)} at ${longDate(asOf)}: base rent of ${lease.currency ?? ''} ${cash(lease.baseRent ?? new D(0))} a month, ${escalation}. ` +
            `The roll is ${lease.currency ?? ''} ${cash(check.difference)} a month (${percent(check.relative)}) above the lease — ${money(lease.currency, check.difference.times(12))} a year of income the lease does not support. The lease governs.`,
          severity: check.relative.gte('0.05') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'Income the lease does not support: NOI comes down to the lease rent, and the price at the cap rate with it; the reviewer prices it.',
          pricedRisk: null,
          evidenceIds: [check.row.id],
          quotes: quotes(lease.rentQuote, lease.escalationQuote),
        });
      }
      if (check.expiryMatches === false && lease.expiry && check.row.leaseEnd) {
        out.push({
          key: `expiry:${check.row.suite}:${check.row.leaseEnd}:${lease.expiry}`,
          domain: 'PROPERTY',
          title: `Rent roll expiry differs from the lease: ${check.row.tenant}`,
          description: `The rent roll says ${check.row.tenant}'s lease (${check.row.suite}) ends ${longDate(check.row.leaseEnd)}; the lease says ${longDate(lease.expiry)}. The lease governs: the rollover schedule and the weighted average lease term follow it.`,
          severity: lease.expiry < check.row.leaseEnd ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'A term shorter or longer than the roll shows moves the rollover schedule the scenarios run on; the reviewer sets the effect.',
          pricedRisk: null,
          evidenceIds: [check.row.id],
          quotes: quotes(lease.termQuote),
        });
      }
    }
    return out;
  },
};

/**
 * The statements' base rent against the leases' rent for each complete year, only once every suite on the
 * roll has a lease whose rent can be recomputed. Beyond 2% the statements do not tie to the leases (−1).
 */
export const CRE_RENT_STATEMENT_RECONCILIATION: PackRule = {
  id: 'cre-rent-statement-reconciliation',
  version: '1',
  evidenceTypes: [LEASE, PNL_LINE, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const currency = billingCurrency(evidence);
    return statementRent(evidence, pages).years.flatMap((year): PackRuleProposal[] => {
      if (!year.relative || year.relative.abs().lte(CRE_STATEMENT_TOLERANCE)) return [];
      return [
        {
          key: `${year.year}:${year.statement.toFixed(2)}:${year.leases.toFixed(2)}`,
          domain: 'PROPERTY',
          title: `Statement rent does not tie to the leases, ${year.year}`,
          description: `The ${year.year} statement books base rent of ${money(currency, year.statement)}; the leases, recomputed month by month with their escalations, give ${money(currency, year.leases)} — ${percent(year.relative.abs())} ${year.difference.isNegative() ? 'below' : 'above'} them.`,
          severity: year.relative.abs().gte('0.05') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'Rent income that does not tie to the leases cannot be relied on for NOI until it is explained; the reviewer sets the effect.',
          pricedRisk: null,
          evidenceIds: year.statementIds.slice(0, MAX_CITED),
        },
      ];
    });
  },
};

/**
 * NNN recoveries billed (the statements) against recoverable under the leases (each net tenant's stated share
 * of the recoverable expense lines), year by year. A shortfall in every year — two years or more — is a trend
 * finding (−1): the leak runs into the hold. One year short is shown on the Leases page, not drafted.
 */
export const CRE_RECOVERY_SHORTFALL: PackRule = {
  id: 'cre-recovery-shortfall',
  version: '1',
  evidenceTypes: [PNL_LINE, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const { netLeases, years } = recoveryYears(evidence, pages);
    if (years.length < 2 || !years.every((year) => year.short)) return [];
    const currency = billingCurrency(evidence);
    const shares = netLeases.reduce((sum, lease) => sum.plus(lease.share ?? 0), new D(0));
    const total = years.reduce((sum, year) => sum.plus(year.shortfall), new D(0));
    const label = span(years.map((year) => year.year));
    return [
      {
        key: `years:${years.map((year) => year.year).join(',')}`,
        domain: 'PROPERTY',
        title: `NNN recoveries short of the leases every year, ${label}`,
        description:
          `${netLeases.length} net leases give their tenants ${percent(shares)} of the recoverable expenses (${years[0]?.poolAccounts.join(', ').toLowerCase() ?? ''}). ` +
          years.map((year) => `${year.year}: recoverable ${money(currency, year.recoverable)} of ${money(currency, year.pool)}, billed ${money(currency, year.billed)}, short ${money(currency, year.shortfall)} (${percent(year.relative ?? new D(0))})`).join('. ') +
          `. ${money(currency, total)} under-recovered across ${years.length} years; a single year would read as one shortfall. Recoverable is the leases' shares of the statements' recoverable lines; billed is the statements' recovery revenue.`,
        severity: (years.at(-1)?.relative ?? new D(0)).gte('0.05') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'A persistent recovery leak comes out of NOI each year of the hold; the reviewer prices it at the cap rate or makes billing catch-up a condition.',
        pricedRisk: null,
        evidenceIds: [...new Set(years.flatMap((year) => year.statementIds))].slice(0, MAX_CITED),
        quotes: quotes(...netLeases.map((lease) => lease.typeQuote)).slice(0, 10),
      },
    ];
  },
};

const OBLIGATION_TITLES = { TENANT_IMPROVEMENT: 'Unfunded tenant improvement allowance', LEASING_COMMISSION: 'Unpaid leasing commission', COMMITTED_CAPEX: 'Committed capex outstanding' } as const;

/**
 * The obligations register, one draft per obligation: a tenant improvement allowance or leasing commission a
 * document says the landlord shall pay, or a committed project in the capex schedule, due on or after the start
 * of the hold. Each passes to the buyer, so each is priced into the bridge at the amount stated (−1).
 */
export const CRE_OBLIGATIONS: PackRule = {
  id: 'cre-obligations',
  version: '1',
  evidenceTypes: [CRE_CAPEX, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const fallback = billingCurrency(evidence);
    return obligations(evidence, pages)
      .filter((entry) => entry.outstanding && entry.amount.gt(0))
      .flatMap((entry): PackRuleProposal[] => {
        const currency = entry.currency ?? fallback;
        if (!currency) return [];
        const due = entry.kind === 'COMMITTED_CAPEX' ? (entry.due ? `scheduled for ${entry.due.slice(0, 4)}` : 'undated') : entry.due ? `due ${longDate(entry.due)}` : 'with no date stated';
        const what =
          entry.kind === 'TENANT_IMPROVEMENT'
            ? `The lease obliges the landlord to fund a tenant improvement allowance of ${money(currency, entry.amount)} for ${entry.party}, ${due}.`
            : entry.kind === 'LEASING_COMMISSION'
              ? `A leasing commission of ${money(currency, entry.amount)} is payable to ${entry.party}, ${due}.`
              : `The seller's capex schedule commits ${money(currency, entry.amount)} to ${entry.party}, ${due}, not yet spent.`;
        return [
          {
            key: entry.key,
            domain: 'PROPERTY',
            title: `${OBLIGATION_TITLES[entry.kind]}: ${entry.party}`,
            description: `${what} It falls due after the hold starts, so it passes to the buyer with the property: priced into the bridge at the amount stated.`,
            severity: 'MEDIUM',
            confidence: 'HIGH',
            direction: -1,
            directionRationale: 'A landlord obligation the buyer inherits: a price reduction at the amount stated, or a credit at closing.',
            pricedRisk: { type: 'PRICE_REDUCTION', currency, low: entry.amount.toFixed(2), high: entry.amount.toFixed(2), basis: `${OBLIGATION_TITLES[entry.kind]} as stated (${money(currency, entry.amount)}), assumed by the buyer at closing.` },
            evidenceIds: entry.evidenceIds,
            quotes: quotes(entry.quote),
          },
        ];
      });
  },
};

/**
 * Concentration and the cliff: a tenant at a quarter of the rent or more whose lease ends in the first two
 * years of the hold (−1). Rent shares come from the leases where read, and the lease governs the expiry; the
 * hold runs from the stated closing. Waits for documents: they set the closing and the expiry.
 */
export const CRE_EXPIRY_CLIFF: PackRule = {
  id: 'cre-expiry-cliff',
  version: '1',
  evidenceTypes: [LEASE, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const { hold, tenants } = tenantRents(evidence, pages);
    if (!hold) return [];
    const holdBasis = hold.basis === 'EXPECTED_CLOSING' ? `the expected closing on ${longDate(hold.from)}` : `${longDate(hold.from)}, the analysis date (no closing date is stated)`;
    return tenants
      .filter((tenant) => tenant.share?.gte(CRE_CLIFF_SHARE) && tenant.holdYear !== null && tenant.holdYear >= 1 && tenant.holdYear <= CRE_CLIFF_YEARS && tenant.expiry)
      .map((tenant): PackRuleProposal => ({
        key: `${tenant.suite}:${tenant.expiry}:${hold.from}`,
        domain: 'PROPERTY',
        title: `Lease-expiry cliff: ${tenant.tenant} (${percent(tenant.share ?? new D(0))} of rent) expires in year ${tenant.holdYear} of the hold`,
        description:
          `${tenant.tenant} pays ${percent(tenant.share ?? new D(0))} of the property's rent (${tenant.source === 'LEASE' ? 'recomputed from the leases' : 'from the rent roll'}) and its lease ends ${longDate(tenant.expiry ?? '')}, in year ${tenant.holdYear} of a ${hold.years}-year hold from ${holdBasis}. ` +
          `${hold.yearsStated ? 'The hold is the one the documents state.' : 'No hold is stated; five years is assumed.'} Renewal, downtime and re-leasing cost on that share of the income decide the hold's NOI.`,
        severity: (tenant.share ?? new D(0)).gte('0.4') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Rollover risk early in the hold on a dominant share of the income: the downside case, a leasing reserve or renewal as a condition, which the reviewer sets.',
        pricedRisk: null,
        evidenceIds: [tenant.rowId],
        quotes: quotes(tenant.lease?.termQuote, hold.closingQuote),
      }));
  },
};

/**
 * Condition evidence: an item a property condition or environmental report recommends at an estimated cost,
 * which no project in the seller's capex schedule covers (−1), priced as remediation at the report's cost.
 * Absence of a capex schedule is shown on the Leases page; nothing is drafted against a schedule not supplied.
 */
export const CRE_CONDITION_CAPEX_GAP: PackRule = {
  id: 'cre-condition-capex-gap',
  version: '1',
  evidenceTypes: [CRE_CAPEX],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const schedule = capexSchedule(evidence);
    if (schedule.length === 0) return [];
    return conditionItems(evidence, pages)
      .filter((item) => item.covered.length === 0)
      .map((item): PackRuleProposal => ({
        key: `${item.element}:${item.amount.toFixed(2)}`,
        domain: 'PROPERTY',
        title: `Condition item missing from the capex schedule: ${item.label}`,
        description: `The report recommends work at an estimated cost of ${money(item.currency, item.amount)}: “${item.quote.quote}” None of the ${schedule.length} projects in the seller's capex schedule covers the ${item.label.toLowerCase()}. Priced as remediation at the report's estimate.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Capex the seller has not scheduled falls on the buyer: remediation at the report’s estimate, off the price or held in escrow.',
        pricedRisk: { type: 'REMEDIATION_COST', currency: item.currency, low: item.amount.toFixed(2), high: item.amount.toFixed(2), basis: `The report's estimated cost (${money(item.currency, item.amount)}), not in the seller's capex schedule.` },
        evidenceIds: schedule.slice(0, MAX_CITED).map((entry) => entry.id),
        quotes: [item.quote],
      }));
  },
};

/** The commercial-property key expenses the multi-year P&L trend watches against revenue. */
export const CRE_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'taxes', label: 'Real estate taxes', pattern: /\b(?:real estate|property) tax/i },
  { key: 'insurance', label: 'Insurance', pattern: /\binsurance\b/i },
  { key: 'repairs', label: 'Repairs and maintenance', pattern: /\brepairs?\b|\bmaintenance\b/i },
  { key: 'utilities', label: 'Utilities', pattern: /\butilit/i },
  { key: 'management', label: 'Property management', pattern: /\bmanagement fee/i },
];

export const [CRE_PNL_TREND, CRE_PNL_MARGIN_DRIFT, CRE_PNL_EXPENSE_OUTPACING] = pnlTrendRules('cre', CRE_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

export const COMMERCIAL_PROPERTY_RULES: readonly PackRule[] = [
  CRE_ANCHOR_ROLLOVER,
  CRE_ENVIRONMENTAL_CONDITION,
  CRE_CAM_UNDER_RECOVERY,
  CRE_BELOW_MARKET_ANCHOR,
  CRE_RENT_ROLL_VERIFICATION,
  CRE_RENT_STATEMENT_RECONCILIATION,
  CRE_RECOVERY_SHORTFALL,
  CRE_OBLIGATIONS,
  CRE_EXPIRY_CLIFF,
  CRE_CONDITION_CAPEX_GAP,
  CRE_PNL_TREND,
  CRE_PNL_MARGIN_DRIFT,
  CRE_PNL_EXPENSE_OUTPACING,
];
export const COMMERCIAL_PROPERTY_EVIDENCE = { LEASE, CAM, CAPEX: CRE_CAPEX } as const;
