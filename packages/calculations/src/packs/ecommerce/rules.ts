import { D } from '../../metrics/decimal';
import type { KeyExpense } from '../../pnl/trend';
import { amountOf, grouped, INVOICE_LINE, latestMonthRevenue, monthName, percent } from '../common';
import { driverTrendRule, recentRunRule, type DriverSpec, type PackHistorySpec } from '../history';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal } from '../rule-types';
import {
  accountOwnership,
  billingCurrency,
  AGED_STOCK_DAYS,
  CHANNEL_MONTH,
  channelMonths,
  channelReconciliation,
  channelYears,
  cohortValue,
  COHORT_MONTH,
  AD_SPEND_MONTH,
  inventoryAgeing,
  MATERIAL_ACCOUNT_SHARE,
  paidAcquisition,
  STOCK_LOT,
  stockLots,
  unitClaims,
  unitEconomicsByYear,
  type UnitClaim,
} from './channels';

/**
 * E-commerce and DTC pack rules (T-065, spec §19). Cohorts and channels are
 * counts and amounts; no customer is ever identified.
 */
const COHORT = 'ecommerce.cohort_month';
const AD_SPEND = 'ecommerce.ad_spend_month';
type Decimal = InstanceType<typeof D>;

/** A marketplace carries most of the latest month's revenue, and its seller terms let it change fees or delist on notice. */
export const ECOMMERCE_MARKETPLACE_MAJORITY: PackRule = {
  id: 'ecommerce-marketplace-majority',
  version: '1',
  evidenceTypes: ['billing.invoice_line'],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const revenue = latestMonthRevenue(evidence);
    const marketplace = revenue?.ranked.find(([name]) => /marketplace/i.test(name));
    if (!revenue || !marketplace) return [];
    const [name, amount] = marketplace;
    const share = amount.div(revenue.total);
    if (share.lte('0.5')) return [];
    const terms = findSentence(pages, (sentence) => /(change (its |the )?fees|delist)/i.test(sentence) && /notice/i.test(sentence));
    if (!terms) return [];
    return [
      {
        key: `${revenue.month}:${name}`,
        domain: 'COMMERCIAL',
        title: 'Majority of revenue through one marketplace',
        description: `${name} is ${percent(share)} of ${monthName(revenue.month)} revenue, and the marketplace's seller terms let it change the business unilaterally: “${terms.quote}”`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A channel-risk sensitivity in the scenarios (fee or ranking change), not a price term.',
        evidenceIds: revenue.linesOf([name]).slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: terms.page.documentId, pageNumber: terms.page.pageNumber, quote: terms.quote }],
      },
    ];
  },
};

/** Second-month retention by cohort: the cohorts from a point on all keep materially fewer customers than every earlier one. */
export const ECOMMERCE_COHORT_REPEAT_DECLINE: PackRule = {
  id: 'ecommerce-cohort-repeat-decline',
  version: '1',
  evidenceTypes: [COHORT],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === COHORT);
    const at = (cohort: string, offset: string) => rows.find((row) => row.canonical['first_purchase_month'] === cohort && amountOf(row, 'months_since_first').eq(offset));
    const cohorts = [...new Set(rows.map((row) => row.canonical['first_purchase_month'] ?? ''))]
      .filter((cohort) => /^\d{4}-\d{2}$/.test(cohort))
      .sort()
      .flatMap((cohort) => {
        const first = at(cohort, '0');
        const second = at(cohort, '1');
        const size = first ? amountOf(first, 'active_customers') : new D(0);
        return first && second && size.gt(0) ? [{ cohort, rows: [first, second], kept: amountOf(second, 'active_customers').div(size) }] : [];
      });
    const average = (list: readonly { kept: Decimal }[]) => list.reduce((sum, entry) => sum.plus(entry.kept), new D(0)).div(list.length);
    for (let split = 1; split < cohorts.length; split += 1) {
      const earlier = cohorts.slice(0, split);
      const recent = cohorts.slice(split);
      // A real break: every recent cohort at least three points below every earlier one.
      const floor = D.min(...earlier.map((entry) => entry.kept)).minus('0.03');
      if (!recent.every((entry) => entry.kept.lt(floor))) continue;
      const before = average(earlier);
      const after = average(recent);
      const start = recent[0]?.cohort ?? '';
      return [
        {
          key: start,
          domain: 'COMMERCIAL',
          title: 'Repeat purchase declining in recent cohorts',
          description: `Cohorts from ${monthName(start)} keep ${percent(after)} of customers in their second month, against ${percent(before)} for the ${earlier.length} earlier cohorts (${recent.length} recent cohorts, each at least 3 points below every earlier one).`,
          severity: before.minus(after).gte('0.1') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'Lifetime value and the growth case should use recent-cohort retention; the reviewer prices the difference.',
          evidenceIds: cohorts.flatMap((entry) => entry.rows).slice(0, MAX_CITED).map((row: PackRuleEvidence) => row.id),
        },
      ];
    }
    return [];
  },
};

/** On a channel, spend rose every month while new customers fell every month, for at least six months. */
export const ECOMMERCE_CHANNEL_CAC_RISING: PackRule = {
  id: 'ecommerce-channel-cac-rising',
  version: '1',
  evidenceTypes: [AD_SPEND],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === AD_SPEND && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''));
    const channels = [...new Set(rows.map((row) => row.canonical['channel'] ?? ''))].filter(Boolean).sort();
    return channels.flatMap((channel) => {
      const series = rows.filter((row) => row.canonical['channel'] === channel).sort((a, b) => (a.canonical['month'] ?? '').localeCompare(b.canonical['month'] ?? ''));
      if (series.length < 6) return [];
      const rising = series.every((row, index) => index === 0 || (amountOf(row, 'spend').gt(amountOf(series[index - 1] as PackRuleEvidence, 'spend')) && amountOf(row, 'new_customers').lt(amountOf(series[index - 1] as PackRuleEvidence, 'new_customers'))));
      const cac = (row: PackRuleEvidence) => (amountOf(row, 'new_customers').gt(0) ? amountOf(row, 'spend').div(amountOf(row, 'new_customers')) : null);
      const first = series[0] as PackRuleEvidence;
      const last = series.at(-1) as PackRuleEvidence;
      const from = cac(first);
      const to = cac(last);
      if (!rising || !from || !to) return [];
      return [
        {
          key: channel,
          domain: 'COMMERCIAL' as const,
          title: `Acquisition cost rising on ${channel}`,
          description: `On ${channel}, spend rose every month for ${series.length} months while new customers fell every month: acquisition cost (spend ÷ new customers) went from ${from.toFixed(2)} in ${monthName(first.canonical['month'] ?? '')} to ${to.toFixed(2)} in ${monthName(last.canonical['month'] ?? '')} (${percent(to.div(from).minus(1))} higher).`,
          severity: to.div(from).gte('1.5') ? ('HIGH' as const) : ('MEDIUM' as const),
          confidence: 'HIGH' as const,
          direction: -1 as const,
          directionRationale: 'Growth bought on this channel costs more each month; the growth case and price follow, priced by the reviewer.',
          evidenceIds: series.slice(-MAX_CITED).map((row) => row.id),
        },
      ];
    });
  },
};


// ---------------------------------------------------------------- channel economics, cohort value and platforms (T-164, ADR 0054)

const cite = (rows: readonly { id: string }[]) => rows.slice(0, MAX_CITED).map((row) => row.id);
const money = (currency: string | null, value: Decimal) => `${currency ? `${currency} ` : ''}${grouped(value)}`;
const money2 = (currency: string | null, value: Decimal) => `${currency ? `${currency} ` : ''}${value.toFixed(2)}`;
const span = (years: readonly { year: string }[]) => (years.length === 1 ? (years[0]?.year ?? '') : `${years[0]?.year ?? ''}–${years.at(-1)?.year ?? ''}`);
const points = (value: Decimal) => `${value.times(100).abs().toFixed(1)} points`;

/** Tolerances for the unit-economics claims, as fractions of the recomputed figure. */
export const UNIT_CLAIM_TOLERANCE = {
  LTV: { verified: '0.05', contradicted: '0.1' },
  CAC: { verified: '0.02', contradicted: '0.05' },
} as const;
/** A stated LTV within this share of the gross-sales figure is read as computed on gross revenue. */
export const GROSS_BASIS_TOLERANCE = '0.02';

function unitClaimProposal(claim: UnitClaim, status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED', basis: string, detail: string, evidenceIds: readonly string[]): PackRuleProposal {
  const quotes = [claim.quote];
  const record = { statement: claim.quote.quote, status, rationale: basis };
  if (status === 'UNVERIFIED')
    return {
      key: `${claim.key}:unverified`,
      domain: 'COMMERCIAL',
      title: `Claim not verified: ${claim.label}`,
      description: `The document states “${claim.quote.quote}” ${basis} Ask the seller for the exports behind it before relying on it.`,
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
      description: `“${claim.quote.quote}” ${detail}`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${claim.label} verified against the exports`, impliedValue: null, basis },
      evidenceIds: evidenceIds.slice(0, MAX_CITED),
      quotes,
      claim: record,
    };
  return {
    key: `${claim.key}:contradicted`,
    domain: 'COMMERCIAL',
    title: `Claim contradicted: ${claim.label}`,
    description: `“${claim.quote.quote}” ${detail}`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'The price was set on unit economics the exports do not support; carry the recomputed figure in the scenarios and price the gap.',
    evidenceIds: evidenceIds.slice(0, MAX_CITED),
    quotes,
    claim: record,
  };
}

/**
 * The unit-economics claims register (the T-083/T-159 pattern): the deck's lifetime value, recomputed
 * on a contribution-margin basis from the cohort and orders exports, and its paid acquisition cost,
 * recomputed from the ad-spend export — each VERIFIED, CONTRADICTED or UNVERIFIED and recorded in the
 * claims register with its finding. A contradicted LTV that matches the same orders on gross sales says so.
 */
export const ECOMMERCE_UNIT_ECONOMICS_CLAIMS: PackRule = {
  id: 'ecommerce-unit-economics-claims',
  version: '1',
  evidenceTypes: [CHANNEL_MONTH, COHORT_MONTH, AD_SPEND_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) =>
    unitClaims(pages).flatMap((claim): PackRuleProposal[] => {
      if (claim.key === 'CAC') {
        const paid = paidAcquisition(evidence);
        if (!paid?.cac || paid.missing.length) return [unitClaimProposal(claim, 'UNVERIFIED', 'The ad-spend export does not hold twelve complete months of spend and attributed new customers.', '', [])];
        const off = claim.value.minus(paid.cac).div(paid.cac);
        const basis = `The ad-spend export gives ${money(claim.currency, paid.spend)} of spend and ${grouped(paid.newCustomers)} attributed new customers for ${monthName(paid.from)} to ${monthName(paid.to)}: ${money2(claim.currency, paid.cac)} per new customer.`;
        if (off.abs().lte(UNIT_CLAIM_TOLERANCE.CAC.verified)) return [unitClaimProposal(claim, 'VERIFIED', basis, `ties to the export. ${basis}`, cite(paid.rows))];
        if (off.abs().gt(UNIT_CLAIM_TOLERANCE.CAC.contradicted)) return [unitClaimProposal(claim, 'CONTRADICTED', basis, `is ${percent(off.abs())} ${off.gt(0) ? 'above' : 'below'} the export. ${basis}`, cite(paid.rows))];
        return [];
      }
      const value = cohortValue(evidence, claim.horizon);
      if (!value) return [unitClaimProposal(claim, 'UNVERIFIED', `The exports do not hold the ${claim.horizon} months of cohort history and twelve complete months of consumer orders the recompute needs.`, '', [])];
      const off = claim.value.minus(value.ltvContribution).div(value.ltvContribution);
      const basis =
        `Cohorts observed for ${claim.horizon} months (${value.repeat.cohorts.length}: ${value.repeat.cohorts.join(', ')}) placed ${value.repeat.ordersPerCustomer.toFixed(2)} orders per customer; ` +
        `consumer orders for ${monthName(value.window.from)} to ${monthName(value.window.to)} average ${money2(claim.currency, value.netOrderValue)} of net sales at a ${percent(value.contributionMargin)} contribution margin, ` +
        `so ${claim.horizon}-month lifetime value on a contribution basis is ${money2(claim.currency, value.ltvContribution)}.`;
      const ids = [...cite(value.window.rows), ...value.repeat.rows.map((row) => row.id)];
      if (off.abs().lte(UNIT_CLAIM_TOLERANCE.LTV.verified)) return [unitClaimProposal(claim, 'VERIFIED', basis, `agrees with the contribution recompute. ${basis}`, ids)];
      if (off.abs().lte(UNIT_CLAIM_TOLERANCE.LTV.contradicted)) return [];
      const gross = claim.value.minus(value.ltvGross).div(value.ltvGross).abs().lte(GROSS_BASIS_TOLERANCE)
        ? ` The stated figure matches the same orders valued at gross sales (${money2(claim.currency, value.ltvGross)}, ${money2(claim.currency, value.grossOrderValue)} per order): it is computed on gross revenue, before discounts, returns, cost of goods, fulfilment and fees.`
        : '';
      return [unitClaimProposal(claim, 'CONTRADICTED', basis, `is ${percent(off.abs())} ${off.gt(0) ? 'above' : 'below'} the contribution recompute. ${basis}${gross}`, ids)];
    }),
};

/** An export year's net sales and the P&L's revenue differing by more than this share is a finding. */
export const CHANNEL_RECONCILIATION_TOLERANCE = '0.02';

/** Revenue by channel recomputed from the orders export, reconciled to the P&L's revenue year by year. */
export const ECOMMERCE_CHANNEL_RECONCILIATION: PackRule = {
  id: 'ecommerce-channel-reconciliation',
  version: '1',
  evidenceTypes: [CHANNEL_MONTH, PNL_LINE],
  detect: ({ evidence }) =>
    channelReconciliation(evidence).flatMap((year): PackRuleProposal[] => {
      if (!year.relative || year.relative.abs().lte(CHANNEL_RECONCILIATION_TOLERANCE)) return [];
      const byChannel = [...new Set(year.rows.map((row) => row.channel))]
        .map((channel) => `${channel} ${grouped(year.rows.filter((row) => row.channel === channel).reduce((total, row) => total.plus(row.net), new D(0)))}`)
        .join(', ');
      return [
        {
          key: `${year.year}`,
          domain: 'FINANCIAL',
          title: `P&L revenue does not reconcile to the channel exports, ${year.year}`,
          description:
            `The imported P&L books ${grouped(year.pnl)} of revenue for ${year.year} (${year.accounts.join(', ')}); the storefront and marketplace exports give ${grouped(year.exports)} of net sales for the same twelve months (${byChannel}), ` +
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

/**
 * Platform dependence: each storefront, marketplace and ad account's share of trailing net sales, and
 * who the documents say it is registered to. A material account (10% or more) registered to an
 * individual personally is a drag: the account, its listings, ratings and payouts may not pass with
 * the business. A smaller one is a closing deliverable. The documents govern, so the check waits for them.
 */
export const ECOMMERCE_PLATFORM_OWNERSHIP: PackRule = {
  id: 'ecommerce-platform-ownership',
  version: '1',
  evidenceTypes: [CHANNEL_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const { window, accounts } = accountOwnership(evidence, pages);
    return accounts.flatMap((entry): PackRuleProposal[] => {
      if (entry.owner !== 'PERSONAL' || !entry.record) return [];
      const name = entry.channel ? `${entry.channel} (${entry.account})` : entry.account;
      const material = entry.share?.gte(MATERIAL_ACCOUNT_SHARE) ?? false;
      if (material && entry.share && window)
        return [
          {
            key: `${entry.account}:personal`,
            domain: 'LEGAL',
            title: `Platform account held personally: ${name}`,
            description:
              `${percent(entry.share)} of net sales for ${monthName(window.from)} to ${monthName(window.to)} (${grouped(entry.net ?? new D(0))} of ${grouped(window.net)}) ran through ${name}, and the document states it is registered to an individual personally, not the company: “${entry.record.quote.quote}” ` +
              'The account, its listings, ratings and payouts may not pass with the business. Make its transfer to the company a closing condition, and price the exposure (an escrow or holdback) until it is done.',
            severity: entry.share.gte('0.5') ? 'CRITICAL' : 'HIGH',
            confidence: 'HIGH',
            direction: -1,
            pricedRisk: null,
            evidenceIds: cite(entry.rows),
            quotes: [entry.record.quote],
          },
        ];
      return [
        {
          key: `${entry.account}:personal-minor`,
          domain: 'LEGAL',
          title: `Account held personally: ${name}`,
          description: `The document states ${name} is registered to an individual personally, not the company: “${entry.record.quote.quote}” ${entry.share ? `It carried ${percent(entry.share)} of net sales in the trailing twelve months.` : 'It carries no sales in the orders export (an ad or support account).'} Move it to the company before closing.`,
          severity: 'MEDIUM',
          confidence: 'HIGH',
          direction: 0,
          directionRationale: 'A closing deliverable (the account moved to the company), not a price adjustment.',
          evidenceIds: cite(entry.rows),
          quotes: [entry.record.quote],
        },
      ];
    });
  },
};

/** A return rate (returns refunded ÷ gross sales) rising every complete year by this much or more, first to last, is a finding. */
export const RETURN_RATE_RISE = '0.01';

/** The return rate by calendar year from the orders export, rising every year. */
export const ECOMMERCE_RETURN_RATE_TREND: PackRule = {
  id: 'ecommerce-return-rate-trend',
  version: '1',
  evidenceTypes: [CHANNEL_MONTH],
  detect: ({ evidence }) => {
    const years = channelYears(channelMonths(evidence)).filter((year) => year.returnRate !== null);
    if (years.length < 2) return [];
    const rates = years.map((year) => year.returnRate as Decimal);
    const first = rates[0] as Decimal;
    const last = rates.at(-1) as Decimal;
    const rising = rates.every((rate, index) => index === 0 || rate.gt(rates[index - 1] as Decimal));
    if (!rising || last.minus(first).lt(RETURN_RATE_RISE)) return [];
    return [
      {
        key: `${years[0]?.year ?? ''}-${years.at(-1)?.year ?? ''}`,
        domain: 'COMMERCIAL',
        title: `Return rate rising, ${span(years)}`,
        description: `Returns refunded rose as a share of gross sales every year: ${years.map((year, index) => `${year.year} ${percent(rates[index] as Decimal)}`).join(', ')} (${points(last.minus(first))} up), from the orders export. Net sales and contribution in the scenarios should carry the latest rate.`,
        severity: last.minus(first).gte('0.03') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: cite(years.flatMap((year) => year.rows)),
      },
    ];
  },
};

/** Aged stock at this share of the stock report's value or more is a finding. */
export const AGED_STOCK_SHARE = '0.1';

/**
 * Inventory ageing from the stock report: stock received more than 180 days before the report date, at
 * landed cost. At 10% of the value or more it is priced as a price reduction — low half of it written
 * down, high all of it — for the reviewer to adjust.
 */
export const ECOMMERCE_INVENTORY_AGEING: PackRule = {
  id: 'ecommerce-inventory-ageing',
  version: '1',
  evidenceTypes: [STOCK_LOT, INVOICE_LINE],
  detect: ({ evidence }) => {
    const ageing = inventoryAgeing(stockLots(evidence));
    if (!ageing?.agedShare || ageing.agedShare.lt(AGED_STOCK_SHARE)) return [];
    const currency = billingCurrency(evidence);
    const low = ageing.agedValue.div(2);
    const bands = ageing.bands.filter((band) => band.value.gt(0)).map((band) => `${band.label} ${money(currency, band.value)}`).join(', ');
    return [
      {
        key: ageing.asOf,
        domain: 'OPERATIONAL',
        title: `Aged inventory: ${percent(ageing.agedShare)} of stock older than ${AGED_STOCK_DAYS} days`,
        description:
          `The stock report at ${ageing.asOf} values ${ageing.lots.length} lots at ${money(currency, ageing.value)} (units × landed cost); ${ageing.aged.length} lots worth ${money(currency, ageing.agedValue)} (${percent(ageing.agedShare)}) were received more than ${AGED_STOCK_DAYS} days before it. ` +
          `By age: ${bands}. Aged stock sells at a discount or not at all; priced as a write-down on the working capital the buyer takes on.`,
        severity: ageing.agedShare.gte('0.2') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: currency
          ? { type: 'PRICE_REDUCTION', currency, low: low.toFixed(2), high: ageing.agedValue.toFixed(2), basis: `Stock older than ${AGED_STOCK_DAYS} days at landed cost (${money(currency, ageing.agedValue)}): low half of it written down, high all of it.` }
          : null,
        evidenceIds: cite(ageing.aged),
      },
    ];
  },
};

/** A blended acquisition cost this many times its first year or more, rising every year, is a finding. */
export const CAC_RISE_FACTOR = '1.1';
/** A consumer contribution margin down this much or more, falling every year, is a finding. */
export const CONTRIBUTION_DRIFT = '0.02';

/**
 * The unit-economics trend by year, the defect a single year misses: blended acquisition cost (the P&L's
 * advertising and marketing ÷ new customers in the orders export) rising every year, and the consumer
 * contribution margin falling every year. Each is its own draft, so an orders export imported before
 * the P&L drafts the contribution trend, and the P&L, when it arrives, adds the acquisition-cost one.
 */
export const ECOMMERCE_UNIT_ECONOMICS_TREND: PackRule = {
  id: 'ecommerce-unit-economics-trend',
  version: '1',
  evidenceTypes: [CHANNEL_MONTH, PNL_LINE, INVOICE_LINE],
  detect: ({ evidence }) => {
    const years = unitEconomicsByYear(evidence);
    const currency = billingCurrency(evidence);
    const withCac = years.filter((year) => year.cac !== null);
    const withMargin = years.filter((year) => year.contributionMargin !== null);
    const cacs = withCac.map((year) => year.cac as Decimal);
    const margins = withMargin.map((year) => year.contributionMargin as Decimal);
    const cacRising = cacs.length >= 2 && cacs.every((cac, index) => index === 0 || cac.gt(cacs[index - 1] as Decimal)) && (cacs.at(-1) as Decimal).gte((cacs[0] as Decimal).times(CAC_RISE_FACTOR));
    const marginFalling = margins.length >= 2 && margins.every((margin, index) => index === 0 || margin.lt(margins[index - 1] as Decimal)) && (margins[0] as Decimal).minus(margins.at(-1) as Decimal).gte(CONTRIBUTION_DRIFT);
    const out: PackRuleProposal[] = [];
    if (cacRising) {
      const first = cacs[0] as Decimal;
      const last = cacs.at(-1) as Decimal;
      out.push({
        key: `cac:${span(withCac)}`,
        domain: 'COMMERCIAL',
        title: `Acquisition cost rising every year, ${span(withCac)}`,
        description:
          `Blended acquisition cost — the imported P&L's advertising and marketing ÷ new customers in the orders export — rose every year: ${withCac.map((year) => `${year.year} ${money2(currency, year.cac as Decimal)} (${grouped(year.marketing ?? new D(0))} ÷ ${grouped(year.newCustomers)})`).join(', ')}, ` +
          `${last.div(first).toFixed(2)}× in ${withCac.length - 1} year${withCac.length === 2 ? '' : 's'}. A single year shows ${money2(currency, last)}, which reads as unremarkable on its own. ` +
          'Each new customer costs more: the growth case and lifetime value in the scenarios should carry the latest year, priced by the reviewer.',
        severity: last.gte(first.times('1.5')) ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: [...new Set([...withCac.flatMap((year) => year.pnlIds), ...cite(withCac.flatMap((year) => year.rows))])].slice(0, MAX_CITED),
      });
    }
    if (marginFalling) {
      const first = margins[0] as Decimal;
      const last = margins.at(-1) as Decimal;
      out.push({
        key: `contribution:${span(withMargin)}`,
        domain: 'COMMERCIAL',
        title: `Contribution margin compressing every year, ${span(withMargin)}`,
        description:
          `The consumer channels' contribution margin — net sales less cost of goods, fulfilment and channel fees, from the orders export — fell every year: ${withMargin.map((year) => `${year.year} ${percent(year.contributionMargin as Decimal)}`).join(', ')}, ` +
          `${points(first.minus(last))} down. A single year shows ${percent(last)}, which reads as unremarkable on its own. Each order earns less: lifetime value and the margin the scenarios assume should carry the latest year, priced by the reviewer.`,
        severity: first.minus(last).gte('0.05') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: cite(withMargin.flatMap((year) => year.rows)),
      });
    }
    return out;
  },
};

/** The e-commerce key expenses the multi-year P&L trend watches against revenue. */
export const ECOMMERCE_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'marketing', label: 'Advertising and marketing', pattern: /\b(?:advertis\w*|marketing)\b/i },
  { key: 'fulfilment', label: 'Fulfilment and shipping', pattern: /\b(?:fulfil\w*|shipping|postage)\b/i },
  { key: 'channel_fees', label: 'Marketplace and payment fees', pattern: /\b(?:marketplace|payment|channel) (?:and payment )?fees?\b/i },
  { key: 'returns', label: 'Returns and refunds', pattern: /\b(?:returns?|refunds?)\b/i },
];

export const [ECOMMERCE_PNL_TREND, ECOMMERCE_PNL_MARGIN_DRIFT, ECOMMERCE_PNL_EXPENSE_OUTPACING] = pnlTrendRules('ecommerce', ECOMMERCE_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/**
 * Five years of history (T-184b, ADR 0057): the P&L by year and, from the orders export by calendar year,
 * orders, consumer order value, the repeat rate and the discount rate. Acquisition cost and contribution by
 * year are ecommerce-unit-economics-trend's; the discount rate climbing every year is the driver trend below.
 */
const CONSUMER = { field: 'platform', values: ['storefront', 'marketplace'] } as const;
export const ECOMMERCE_DRIVERS = {
  orders: { key: 'orders', label: 'Orders', unit: 'COUNT', evidenceType: CHANNEL_MONTH, mode: 'SUM', numerator: ['orders'], formula: 'Σ orders in the year, every channel' },
  orderValue: {
    key: 'net_order_value',
    label: 'Net order value, consumer channels',
    unit: 'MONEY',
    evidenceType: CHANNEL_MONTH,
    mode: 'RATIO',
    numerator: ['gross_sales'],
    numeratorLess: ['discounts', 'returns'],
    numeratorWhere: CONSUMER,
    denominator: ['orders'],
    denominatorWhere: CONSUMER,
    formula: 'Σ (gross sales − discounts − returns) ÷ Σ orders in the year, storefront and marketplaces',
  },
  repeatRate: {
    key: 'repeat_rate',
    label: 'Repeat orders, consumer channels',
    unit: 'RATIO',
    evidenceType: CHANNEL_MONTH,
    mode: 'RATIO',
    numerator: ['new_customers'],
    numeratorWhere: CONSUMER,
    denominator: ['orders'],
    denominatorWhere: CONSUMER,
    complement: true,
    formula: '1 − Σ new customers ÷ Σ orders in the year, storefront and marketplaces',
  },
  discountRate: { key: 'discount_rate', label: 'Discount rate', unit: 'RATIO', evidenceType: CHANNEL_MONTH, mode: 'RATIO', numerator: ['discounts'], denominator: ['gross_sales'], formula: 'Σ discounts ÷ Σ gross sales in the year, every channel' },
} as const satisfies Record<string, DriverSpec>;

export const ECOMMERCE_HISTORY: PackHistorySpec = {
  drivers: [ECOMMERCE_DRIVERS.orders, ECOMMERCE_DRIVERS.orderValue, ECOMMERCE_DRIVERS.repeatRate, ECOMMERCE_DRIVERS.discountRate],
  keyExpenses: ECOMMERCE_KEY_EXPENSES,
  driverImport: 'ECOMMERCE_CHANNEL_ORDERS',
  driverLabel: 'Orders by channel',
  driverWhat: 'orders-by-channel history',
};

/** The discount rate climbing every year by this much or more, first year to last (1 point of gross sales). */
export const DISCOUNT_CLIMB_POINTS = '0.01';

export const ECOMMERCE_DISCOUNT_TREND = driverTrendRule(
  {
    id: 'ecommerce-discount-trend',
    driver: ECOMMERCE_DRIVERS.discountRate,
    adverse: 'UP',
    threshold: DISCOUNT_CLIMB_POINTS,
    domain: 'COMMERCIAL',
    advice: 'A growing share of each sale is given away in discounts: growth is being bought. Check promotion calendars and full-price sell-through before carrying today\'s growth into the scenarios.',
  },
  ECOMMERCE_HISTORY,
);

export const ECOMMERCE_RULES: readonly PackRule[] = [
  ECOMMERCE_MARKETPLACE_MAJORITY,
  ECOMMERCE_COHORT_REPEAT_DECLINE,
  ECOMMERCE_CHANNEL_CAC_RISING,
  ECOMMERCE_UNIT_ECONOMICS_CLAIMS,
  ECOMMERCE_CHANNEL_RECONCILIATION,
  ECOMMERCE_PLATFORM_OWNERSHIP,
  ECOMMERCE_RETURN_RATE_TREND,
  ECOMMERCE_INVENTORY_AGEING,
  ECOMMERCE_UNIT_ECONOMICS_TREND,
  ECOMMERCE_PNL_TREND,
  ECOMMERCE_PNL_MARGIN_DRIFT,
  ECOMMERCE_PNL_EXPENSE_OUTPACING,
  ECOMMERCE_DISCOUNT_TREND,
  // The recent run against the long run (T-185): quiet until ten years or more are read.
  recentRunRule('ecommerce', ECOMMERCE_HISTORY),
];
export const ECOMMERCE_EVIDENCE = { COHORT, AD_SPEND, CHANNEL_MONTH, STOCK_LOT } as const;
