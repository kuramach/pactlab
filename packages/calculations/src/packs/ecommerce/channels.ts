import { D, parseDecimal } from '../../metrics/decimal';
import { pnlForPeriod, pnlPeriods } from '../../pnl/pnl';
import { pnlLinesFromRecords } from '../../pnl/trend';
import { INVOICE_LINE } from '../common';
import { monthsTo } from '../fintech/payments';
import { PNL_LINE } from '../pnl-trend';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The e-commerce and DTC channel model (T-164, ADR 0054), deterministic and decimal-only: revenue by
 * channel and platform account recomputed from the storefront and marketplace exports and reconciled to
 * the P&L by year; the contribution margin (net sales less cost of goods, fulfilment and channel fees);
 * cohort value — orders per customer from the cohort export times the contribution per order — against
 * the lifetime value and acquisition cost the deck states; who each platform account is registered to,
 * as the documents state it; the return rate by year; and inventory ageing from the stock report. Every
 * figure names the rows or the sentence it rests on. Exports and documents only: nothing is scraped.
 * Changing a rule is a new ECOMMERCE_CHANNELS_VERSION, never a silent edit.
 */
export const ECOMMERCE_CHANNELS_VERSION = 'ecommerce-channels-1';
export const CHANNEL_MONTH = 'ecommerce.channel_month';
export const STOCK_LOT = 'ecommerce.stock_lot';
export const COHORT_MONTH = 'ecommerce.cohort_month';
export const AD_SPEND_MONTH = 'ecommerce.ad_spend_month';

export const ECOMMERCE_CONVENTIONS = [
  'Net sales are gross sales less discounts and returns refunded; contribution is net sales less cost of goods, fulfilment and shipping, and marketplace and payment fees.',
  'Consumer channels are the own storefront and the marketplaces; wholesale is left out of order value, contribution margin and customer counts.',
  'Cohort value counts each active customer-month in the cohort export as one order; orders per customer are summed over the horizon for every cohort observed for all of it.',
  'Lifetime value on a contribution basis is orders per customer × consumer contribution per order over the trailing twelve months; the gross figure uses gross sales per order instead.',
  'Paid acquisition cost is ad spend ÷ new customers attributed in the ad-spend export, over its trailing twelve months; the yearly acquisition cost is the P&L’s advertising and marketing ÷ new customers in the orders export.',
  'A year is read only when all twelve of its months are in the export, never scaled up.',
  'Stock is aged from the date it was received to the stock report’s date; its value is units × unit cost.',
] as const;

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const zero = () => new D(0);
const cap = (text: string) => (text.length > 400 ? text.slice(0, 400) : text);

export interface ChannelMonth {
  readonly id: string;
  readonly month: string;
  readonly channel: string;
  /** storefront, marketplace or wholesale, lower-cased as imported. */
  readonly platform: string;
  readonly account: string;
  readonly orders: Decimal;
  readonly newCustomers: Decimal | null;
  readonly gross: Decimal;
  readonly discounts: Decimal;
  readonly returns: Decimal;
  /** Gross sales − discounts − returns. */
  readonly net: Decimal;
  readonly cogs: Decimal;
  readonly fulfilment: Decimal;
  readonly fees: Decimal;
  /** Net − cost of goods − fulfilment − channel fees. */
  readonly contribution: Decimal;
}

/** The orders export's rows, by month then channel; a row without a month or gross sales is skipped. */
export function channelMonths(evidence: readonly PackRuleEvidence[]): ChannelMonth[] {
  return evidence
    .filter((row) => row.evidenceType === CHANNEL_MONTH)
    .flatMap((row) => {
      const month = (row.canonical['month'] ?? '').trim();
      const gross = dec(row.canonical['gross_sales']);
      if (!MONTH.test(month) || !gross) return [];
      const discounts = dec(row.canonical['discounts']) ?? zero();
      const returns = dec(row.canonical['returns']) ?? zero();
      const cogs = dec(row.canonical['cogs']) ?? zero();
      const fulfilment = dec(row.canonical['fulfilment']) ?? zero();
      const fees = dec(row.canonical['channel_fees']) ?? zero();
      const net = gross.minus(discounts).minus(returns);
      return [
        {
          id: row.id,
          month,
          channel: (row.canonical['channel'] ?? '').trim(),
          platform: (row.canonical['platform'] ?? '').trim().toLowerCase(),
          account: (row.canonical['account'] ?? '').trim(),
          orders: dec(row.canonical['orders']) ?? zero(),
          newCustomers: dec(row.canonical['new_customers']),
          gross,
          discounts,
          returns,
          net,
          cogs,
          fulfilment,
          fees,
          contribution: net.minus(cogs).minus(fulfilment).minus(fees),
        },
      ];
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.channel.localeCompare(b.channel) || a.account.localeCompare(b.account) || a.id.localeCompare(b.id));
}

export const isConsumer = (row: ChannelMonth) => row.platform !== 'wholesale';

export interface ChannelTotals {
  readonly rows: readonly ChannelMonth[];
  readonly orders: Decimal;
  readonly newCustomers: Decimal;
  readonly gross: Decimal;
  readonly returns: Decimal;
  readonly net: Decimal;
  readonly contribution: Decimal;
  /** Contribution ÷ net sales. */
  readonly contributionMargin: Decimal | null;
  /** Returns refunded ÷ gross sales. */
  readonly returnRate: Decimal | null;
}

export function totals(rows: readonly ChannelMonth[]): ChannelTotals {
  const sum = (pick: (row: ChannelMonth) => Decimal) => rows.reduce((total, row) => total.plus(pick(row)), zero());
  const net = sum((row) => row.net);
  const gross = sum((row) => row.gross);
  const contribution = sum((row) => row.contribution);
  const returns = sum((row) => row.returns);
  return {
    rows,
    orders: sum((row) => row.orders),
    newCustomers: sum((row) => row.newCustomers ?? zero()),
    gross,
    returns,
    net,
    contribution,
    contributionMargin: net.gt(0) ? contribution.div(net) : null,
    returnRate: gross.gt(0) ? returns.div(gross) : null,
  };
}

export interface ChannelWindow extends ChannelTotals {
  readonly from: string;
  readonly to: string;
  /** Months of the window with no row in the export. */
  readonly missing: readonly string[];
}

/** The twelve months (or `length`) ending at `end`, over the rows `keep` admits. */
export function channelWindow(rows: readonly ChannelMonth[], end: string, keep: (row: ChannelMonth) => boolean = () => true, length = 12): ChannelWindow {
  const months = monthsTo(end, length);
  const inside = rows.filter((row) => months.includes(row.month) && keep(row));
  return { ...totals(inside), from: months[0] ?? end, to: end, missing: months.filter((month) => !inside.some((row) => row.month === month)) };
}

export interface AccountShare {
  readonly account: string;
  readonly channel: string;
  readonly platform: string;
  readonly net: Decimal;
  /** Of all channels' net sales in the window. */
  readonly share: Decimal | null;
  readonly rows: readonly ChannelMonth[];
}

/** Net sales by platform account over a window, largest first. */
export function accountShares(window: ChannelWindow): AccountShare[] {
  const accounts = [...new Set(window.rows.map((row) => row.account))];
  return accounts
    .map((account) => {
      const rows = window.rows.filter((row) => row.account === account);
      const net = rows.reduce((total, row) => total.plus(row.net), zero());
      return { account, channel: rows[0]?.channel ?? '', platform: rows[0]?.platform ?? '', net, share: window.net.gt(0) ? net.div(window.net) : null, rows };
    })
    .sort((a, b) => b.net.comparedTo(a.net) || a.account.localeCompare(b.account));
}

export interface ChannelModel {
  readonly latestMonth: string | null;
  /** All channels, trailing twelve months. */
  readonly trailing: ChannelWindow | null;
  /** Consumer channels only, trailing twelve months. */
  readonly consumer: ChannelWindow | null;
  readonly accounts: readonly AccountShare[];
  readonly channels: readonly string[];
}

export function channelModel(rows: readonly ChannelMonth[]): ChannelModel {
  const latestMonth = rows.at(-1)?.month ?? null;
  if (!latestMonth) return { latestMonth: null, trailing: null, consumer: null, accounts: [], channels: [] };
  const trailing = channelWindow(rows, latestMonth);
  return { latestMonth, trailing, consumer: channelWindow(rows, latestMonth, isConsumer), accounts: accountShares(trailing), channels: [...new Set(rows.map((row) => row.channel))].sort() };
}

// ------------------------------------------------------------------ by calendar year

export interface ChannelYear extends ChannelTotals {
  readonly year: string;
  /** Consumer channels only. */
  readonly consumer: ChannelTotals;
}

/** Calendar years with all twelve months in the export, oldest first. */
export function channelYears(rows: readonly ChannelMonth[]): ChannelYear[] {
  const years = [...new Set(rows.map((row) => row.month.slice(0, 4)))].sort();
  return years.flatMap((year) => {
    const window = channelWindow(rows, `${year}-12`);
    if (window.missing.length) return [];
    return [{ ...totals(window.rows), year, consumer: totals(window.rows.filter(isConsumer)) }];
  });
}

/** P&L lines read as revenue, and the advertising lines the yearly acquisition cost reads. */
export const ADVERTISING_LINE = /\b(?:advertis\w*|marketing)\b/i;

/** The orders export's net sales for each calendar year it covers in full, against the P&L's revenue lines. */
export function channelReconciliation(evidence: readonly PackRuleEvidence[]) {
  const years = channelYears(channelMonths(evidence));
  const periods = pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE)));
  return years.flatMap((year) => {
    const read = pnlForPeriod(periods, year.year);
    if (!read) return [];
    const lines = read.sources.filter((row) => row.kind === 'REVENUE');
    if (lines.length === 0) return [];
    const pnl = lines.reduce((total, row) => total.plus(row.amount), zero());
    const difference = pnl.minus(year.net);
    return [{ year: year.year, exports: year.net, pnl, difference, relative: year.net.gt(0) ? difference.div(year.net) : null, accounts: [...new Set(lines.map((row) => row.account))], rows: year.rows, pnlIds: lines.map((row) => row.evidenceId) }];
  });
}

export interface UnitEconomicsYear {
  readonly year: string;
  /** Consumer contribution ÷ consumer net sales. */
  readonly contributionMargin: Decimal | null;
  readonly newCustomers: Decimal;
  /** The P&L's advertising and marketing for the year, when the P&L holds the year. */
  readonly marketing: Decimal | null;
  /** Marketing ÷ new customers. */
  readonly cac: Decimal | null;
  readonly rows: readonly ChannelMonth[];
  readonly pnlIds: readonly string[];
}

/** Contribution margin and blended acquisition cost by calendar year: the orders export with the P&L's marketing lines. */
export function unitEconomicsByYear(evidence: readonly PackRuleEvidence[]): UnitEconomicsYear[] {
  const periods = pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE)));
  return channelYears(channelMonths(evidence)).map((year) => {
    const read = pnlForPeriod(periods, year.year);
    const lines = read ? read.sources.filter((row) => row.kind !== 'REVENUE' && ADVERTISING_LINE.test(row.account)) : [];
    const marketing = lines.length ? lines.reduce((total, row) => total.plus(new D(row.amount).abs()), zero()) : null;
    const newCustomers = year.consumer.newCustomers;
    return {
      year: year.year,
      contributionMargin: year.consumer.contributionMargin,
      newCustomers,
      marketing,
      cac: marketing && newCustomers.gt(0) ? marketing.div(newCustomers) : null,
      rows: year.consumer.rows,
      pnlIds: lines.map((row) => row.evidenceId),
    };
  });
}

// ------------------------------------------------------------------ cohort value and acquisition cost

export interface CohortRepeat {
  readonly horizon: number;
  readonly cohorts: readonly string[];
  readonly customers: Decimal;
  readonly activeMonths: Decimal;
  /** Active customer-months per first-month customer over the horizon. */
  readonly ordersPerCustomer: Decimal;
  readonly rows: readonly PackRuleEvidence[];
}

/** Orders per customer over the first `horizon` months, from every cohort observed for all of them. */
export function cohortRepeat(evidence: readonly PackRuleEvidence[], horizon = 12): CohortRepeat | null {
  const rows = evidence.filter((row) => row.evidenceType === COHORT_MONTH);
  const byCohort = new Map<string, Map<number, PackRuleEvidence>>();
  for (const row of rows) {
    const cohort = (row.canonical['first_purchase_month'] ?? '').trim();
    const offset = Number(dec(row.canonical['months_since_first'])?.toFixed(0) ?? 'NaN');
    if (!MONTH.test(cohort) || !Number.isInteger(offset)) continue;
    byCohort.set(cohort, (byCohort.get(cohort) ?? new Map()).set(offset, row));
  }
  const complete = [...byCohort.entries()].filter(([, offsets]) => Array.from({ length: horizon }, (_, index) => offsets.has(index)).every(Boolean)).sort(([a], [b]) => a.localeCompare(b));
  if (complete.length === 0) return null;
  let customers = zero();
  let active = zero();
  const used: PackRuleEvidence[] = [];
  for (const [, offsets] of complete) {
    for (let index = 0; index < horizon; index += 1) {
      const row = offsets.get(index) as PackRuleEvidence;
      const count = dec(row.canonical['active_customers']) ?? zero();
      if (index === 0) customers = customers.plus(count);
      active = active.plus(count);
      used.push(row);
    }
  }
  if (!customers.gt(0)) return null;
  return { horizon, cohorts: complete.map(([cohort]) => cohort), customers, activeMonths: active, ordersPerCustomer: active.div(customers), rows: used };
}

export interface CohortValue {
  readonly repeat: CohortRepeat;
  readonly window: ChannelWindow;
  /** Consumer net sales ÷ consumer orders, trailing. */
  readonly netOrderValue: Decimal;
  /** Consumer gross sales ÷ consumer orders, trailing. */
  readonly grossOrderValue: Decimal;
  readonly contributionMargin: Decimal;
  /** Orders per customer × contribution per order. */
  readonly ltvContribution: Decimal;
  /** Orders per customer × gross sales per order. */
  readonly ltvGross: Decimal;
}

/** Lifetime value over the horizon, on a contribution basis and (for comparison) on gross sales. */
export function cohortValue(evidence: readonly PackRuleEvidence[], horizon = 12): CohortValue | null {
  const repeat = cohortRepeat(evidence, horizon);
  const model = channelModel(channelMonths(evidence));
  const window = model.consumer;
  if (!repeat || !window || window.missing.length || !window.orders.gt(0) || !window.contributionMargin) return null;
  const netOrderValue = window.net.div(window.orders);
  const grossOrderValue = window.gross.div(window.orders);
  return {
    repeat,
    window,
    netOrderValue,
    grossOrderValue,
    contributionMargin: window.contributionMargin,
    ltvContribution: repeat.ordersPerCustomer.times(window.contribution.div(window.orders)),
    ltvGross: repeat.ordersPerCustomer.times(grossOrderValue),
  };
}

export interface PaidAcquisition {
  readonly from: string;
  readonly to: string;
  readonly missing: readonly string[];
  readonly spend: Decimal;
  readonly newCustomers: Decimal;
  readonly cac: Decimal | null;
  readonly rows: readonly PackRuleEvidence[];
}

/** Ad spend ÷ attributed new customers over the ad-spend export's trailing twelve months, every channel. */
export function paidAcquisition(evidence: readonly PackRuleEvidence[]): PaidAcquisition | null {
  const rows = evidence.filter((row) => row.evidenceType === AD_SPEND_MONTH && MONTH.test((row.canonical['month'] ?? '').trim()));
  const latest = rows.map((row) => (row.canonical['month'] ?? '').trim()).sort().at(-1);
  if (!latest) return null;
  const months = monthsTo(latest);
  const inside = rows.filter((row) => months.includes((row.canonical['month'] ?? '').trim()));
  const spend = inside.reduce((total, row) => total.plus(dec(row.canonical['spend']) ?? zero()), zero());
  const newCustomers = inside.reduce((total, row) => total.plus(dec(row.canonical['new_customers']) ?? zero()), zero());
  return { from: months[0] ?? latest, to: latest, missing: months.filter((month) => !inside.some((row) => row.canonical['month'] === month)), spend, newCustomers, cac: newCustomers.gt(0) ? spend.div(newCustomers) : null, rows: inside };
}

// ------------------------------------------------------------------ what the documents state

export type UnitClaimKey = 'LTV' | 'CAC';
export interface UnitClaim {
  readonly key: UnitClaimKey;
  readonly label: string;
  readonly value: Decimal;
  readonly currency: string;
  /** The months an LTV claim covers ("12-month LTV"); 12 when it does not say. */
  readonly horizon: number;
  readonly quote: PackRuleQuote;
}

const CLAIM_LABELS: Readonly<Record<UnitClaimKey, string>> = { LTV: 'Customer lifetime value', CAC: 'Paid customer acquisition cost' };
const MONEY = /\b([A-Z]{3})\s?([0-9][0-9,]*(?:\.[0-9]+)?)/;
const LTV = /\b(?:lifetime value|LTV)\b/i;
const CAC = /\b(?:customer acquisition cost|acquisition cost|CAC)\b/i;
const HORIZON = /\b(\d{1,2})[- ]month\b/i;

/** The unit-economics claims a deck states: lifetime value and acquisition cost, first of each, with an amount. */
export function unitClaims(pages: readonly PackRulePage[]): UnitClaim[] {
  const found = new Map<UnitClaimKey, UnitClaim>();
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      const money = MONEY.exec(sentence);
      const value = money ? dec(money[2]) : null;
      if (!money || !value) continue;
      const key: UnitClaimKey | null = LTV.test(sentence) && !CAC.test(sentence) ? 'LTV' : CAC.test(sentence) && !LTV.test(sentence) ? 'CAC' : null;
      if (!key || found.has(key)) continue;
      const horizon = Number(HORIZON.exec(sentence)?.[1] ?? '12');
      found.set(key, { key, label: CLAIM_LABELS[key], value, currency: money[1] ?? '', horizon: horizon > 0 ? horizon : 12, quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) } });
    }
  }
  return [...found.values()];
}

export type AccountOwner = 'COMPANY' | 'PERSONAL';
export interface AccountRecord {
  readonly account: string;
  readonly owner: AccountOwner;
  readonly quote: PackRuleQuote;
}

/** A platform-account document, recognised by its heading: an account schedule, register or registration. */
const ACCOUNT_HEADING = /\b(?:platform accounts?|account (?:schedule|register|registration|records?)|seller account|store account|ad(?:vertising)? accounts?)\b/i;
const ACCOUNT_ID = /\b([A-Z]{2,6}-[A-Z0-9]*\d[A-Z0-9]*(?:-[A-Z0-9]+)*)\b/g;
const REGISTERED = /\b(?:registered|held|owned|opened|in the name)\b/i;
const PERSONAL = /\b(?:personally|personal (?:name|capacity|account)|in (?:his|her|their) own names?|as an individual)\b/i;
const COMPANY = /\b(?:the company|company['’]s name|company-owned|the business|business account)\b/i;

/**
 * Who each platform account is registered to, as a platform-account document states it: one sentence
 * that names the account and says it is registered to, held or owned by the company or an individual
 * personally. Read only from documents whose heading names platform accounts, so the paged extracts
 * never verify themselves. The first statement per account wins.
 */
export function accountRecords(pages: readonly PackRulePage[]): AccountRecord[] {
  const firstPage = new Map<string, number>();
  for (const page of pages) firstPage.set(page.documentId, Math.min(firstPage.get(page.documentId) ?? page.pageNumber, page.pageNumber));
  const headed = new Set(
    pages.filter((page) => firstPage.get(page.documentId) === page.pageNumber && ACCOUNT_HEADING.test(sentences(page.text)[0] ?? '')).map((page) => page.documentId),
  );
  const found = new Map<string, AccountRecord>();
  for (const page of pages) {
    if (!headed.has(page.documentId)) continue;
    for (const sentence of sentences(page.text)) {
      if (!/\baccount\b/i.test(sentence) || !REGISTERED.test(sentence)) continue;
      const owner: AccountOwner | null = PERSONAL.test(sentence) ? 'PERSONAL' : COMPANY.test(sentence) ? 'COMPANY' : null;
      if (!owner) continue;
      for (const match of sentence.matchAll(ACCOUNT_ID)) {
        const account = match[1] ?? '';
        if (account && !found.has(account)) found.set(account, { account, owner, quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) } });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.account.localeCompare(b.account));
}

/** An account carrying at least this share of trailing net sales is material. */
export const MATERIAL_ACCOUNT_SHARE = '0.1';

export interface AccountOwnership {
  readonly account: string;
  readonly channel: string | null;
  readonly platform: string | null;
  readonly net: Decimal | null;
  readonly share: Decimal | null;
  readonly owner: AccountOwner | 'UNSTATED';
  readonly record: AccountRecord | null;
  readonly rows: readonly ChannelMonth[];
}

/** Every account in the trailing window or the documents, with its share and who it is registered to. */
export function accountOwnership(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): { window: ChannelWindow | null; accounts: AccountOwnership[] } {
  const model = channelModel(channelMonths(evidence));
  const records = accountRecords(pages);
  const fromExport: AccountOwnership[] = model.accounts.map((share) => {
    const record = records.find((entry) => entry.account === share.account) ?? null;
    return { account: share.account, channel: share.channel, platform: share.platform, net: share.net, share: share.share, owner: record?.owner ?? 'UNSTATED', record, rows: share.rows };
  });
  const documentsOnly: AccountOwnership[] = records
    .filter((record) => !model.accounts.some((share) => share.account === record.account))
    .map((record) => ({ account: record.account, channel: null, platform: null, net: null, share: null, owner: record.owner, record, rows: [] }));
  return { window: model.trailing, accounts: [...fromExport, ...documentsOnly] };
}

// ------------------------------------------------------------------ stock

export interface StockLot {
  readonly id: string;
  readonly sku: string;
  readonly location: string;
  readonly units: Decimal;
  readonly unitCost: Decimal;
  readonly value: Decimal;
  readonly receivedOn: string;
  readonly asOf: string;
  /** Whole days from receipt to the report date. */
  readonly ageDays: number;
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The latest stock report's lots (the rows with the latest report date); a row without dates or units is skipped. */
export function stockLots(evidence: readonly PackRuleEvidence[]): StockLot[] {
  const lots = evidence
    .filter((row) => row.evidenceType === STOCK_LOT)
    .flatMap((row) => {
      const receivedOn = (row.canonical['received_on'] ?? '').trim();
      const asOf = (row.canonical['as_of'] ?? '').trim();
      const units = dec(row.canonical['units']);
      const unitCost = dec(row.canonical['unit_cost']);
      if (!ISO_DATE.test(receivedOn) || !ISO_DATE.test(asOf) || !units || !unitCost) return [];
      return [{ id: row.id, sku: (row.canonical['sku'] ?? '').trim(), location: (row.canonical['location'] ?? '').trim(), units, unitCost, value: units.times(unitCost), receivedOn, asOf, ageDays: days(receivedOn, asOf) }];
    });
  const latest = lots.map((lot) => lot.asOf).sort().at(-1);
  return lots.filter((lot) => lot.asOf === latest).sort((a, b) => b.ageDays - a.ageDays || a.sku.localeCompare(b.sku) || a.id.localeCompare(b.id));
}

/** Stock older than this many days at the report date is aged. */
export const AGED_STOCK_DAYS = 180;
export const STOCK_AGE_BANDS = [
  { key: '0-90', label: '0–90 days', from: 0, to: 90 },
  { key: '91-180', label: '91–180 days', from: 91, to: 180 },
  { key: '181-365', label: '181–365 days', from: 181, to: 365 },
  { key: '365+', label: 'Over 365 days', from: 366, to: Number.POSITIVE_INFINITY },
] as const;

export interface InventoryAgeing {
  readonly asOf: string;
  readonly lots: readonly StockLot[];
  readonly value: Decimal;
  readonly aged: readonly StockLot[];
  readonly agedValue: Decimal;
  /** Aged value ÷ total value. */
  readonly agedShare: Decimal | null;
  readonly bands: readonly { key: string; label: string; value: Decimal; lots: number }[];
}

export function inventoryAgeing(lots: readonly StockLot[]): InventoryAgeing | null {
  const asOf = lots[0]?.asOf;
  if (!asOf) return null;
  const value = lots.reduce((total, lot) => total.plus(lot.value), zero());
  const aged = lots.filter((lot) => lot.ageDays > AGED_STOCK_DAYS);
  const agedValue = aged.reduce((total, lot) => total.plus(lot.value), zero());
  return {
    asOf,
    lots,
    value,
    aged,
    agedValue,
    agedShare: value.gt(0) ? agedValue.div(value) : null,
    bands: STOCK_AGE_BANDS.map((band) => {
      const inside = lots.filter((lot) => lot.ageDays >= band.from && lot.ageDays <= band.to);
      return { key: band.key, label: band.label, value: inside.reduce((total, lot) => total.plus(lot.value), zero()), lots: inside.length };
    }),
  };
}

/** The deal's currency, from the billing lines (the stock report and orders export carry none). */
export function billingCurrency(evidence: readonly PackRuleEvidence[]): string | null {
  const currencies = new Set(evidence.filter((row) => row.evidenceType === INVOICE_LINE).map((row) => (row.canonical['currency'] ?? '').trim()).filter(Boolean));
  return currencies.size === 1 ? ([...currencies][0] ?? null) : null;
}
