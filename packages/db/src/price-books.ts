import { currencyMinorUnits, type PriceBook, type PriceBookAllowance, type StoredQuoteLine } from '@pactlab/domain';
import { asApp } from './auth-role';
import type { PrismaClient } from './client';
import { OperatorRequiredError } from './ops';
import { decodeCursor, encodeCursor, type PageRequest, type PageResult } from './pagination';

/**
 * Per-deal price books, pact promo codes and stored quotes (T-177a, ADR 0061), behind
 * pactlab_billing SECURITY DEFINER functions. The engine (packages/domain/src/pricing) does the
 * arithmetic; this module stores what it produced. Amounts are decimal strings, never floats.
 */

export type PriceBookStatus = 'DRAFT' | 'PUBLISHED';

/** A stored version: the engine's book, with its id, status and lineage. A draft has no effective time yet. */
export interface StoredPriceBook extends Omit<PriceBook, 'effectiveFrom'> {
  id: string;
  status: PriceBookStatus;
  effectiveFrom: string | null;
  basedOnVersionId: string | null;
  suggestedFrom: { currency: string; version: number; rate: string; rateDate: string } | null;
  createdBy: string | null;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  firstQuotedAt: string | null;
}

export type PricingPromoEffect = 'PERCENT_TOTAL' | 'PERCENT_FIXED' | 'AMOUNT_OFF' | 'WAIVE_VARIABLE' | 'PILOT_FLAT';
export type PricingPromoStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED';
export type PricingPromoScope = 'ANY' | 'PILOT_ONLY' | 'ORGANIZATIONS';

export interface PricingPromoInput {
  code: string;
  description: string;
  effect: PricingPromoEffect;
  percent: string | null;
  amount: string | null;
  pilotFlat: string | null;
  currency: string | null;
  markets: string[];
  stackable: boolean;
  scope: PricingPromoScope;
  organizationIds: string[];
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  maxPerOrganization: number;
}

export interface PricingPromoRow extends Omit<PricingPromoInput, 'validFrom'> {
  id: string;
  validFrom: string;
  status: PricingPromoStatus;
  createdAt: string;
  redemptions: number;
  byMarket: { currency: string; uses: number; forgone: string }[];
}

export type PricingPromoReason = 'OK' | 'UNKNOWN' | 'PAUSED' | 'NOT_YET' | 'EXPIRED' | 'USED_UP' | 'ALREADY' | 'NOT_ELIGIBLE' | 'RATE_LIMITED';

export interface PricingPromoCheck {
  reason: PricingPromoReason;
  promo: Pick<PricingPromoRow, 'id' | 'code' | 'effect' | 'percent' | 'amount' | 'pilotFlat' | 'currency' | 'markets' | 'stackable'> | null;
}

export type QuoteLineKind = StoredQuoteLine['kind'];
export type QuoteLine = StoredQuoteLine;

export type QuoteStatus = 'OPEN' | 'CONSUMED' | 'EXPIRED' | 'VOIDED';
export type QuoteApplied = 'NONE' | 'RESELLER' | 'PROMO' | 'BOTH';

export interface QuoteRecordInput {
  versionId: string;
  currency: string;
  enterpriseValue: string | null;
  pilot: boolean;
  promoCode: string | null;
  promoId: string | null;
  promoRefusal: string | null;
  partnerCode: string | null;
  resellerPercent: string | null;
  subtotal: string;
  total: string;
  applied: QuoteApplied;
  includes: PriceBookAllowance;
  dealId: string | null;
  engineVersion: string;
  lines: QuoteLine[];
}

export interface StoredQuote extends Omit<QuoteRecordInput, 'versionId'> {
  id: string;
  organizationId: string;
  bookVersionId: string;
  bookVersion: number;
  variableCap: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  status: QuoteStatus;
  consumedAt: string | null;
}

export type QuoteConsumeResult = 'CONSUMED' | 'UNKNOWN' | 'NOT_OPEN' | 'EXPIRED' | 'NO_SUCH_PACT' | 'PROMO_USED_UP' | 'PROMO_ALREADY';

export interface PromoRedemptionRow {
  id: string;
  organizationId: string;
  organizationName: string;
  quoteId: string;
  dealId: string;
  currency: string;
  amountForgone: string;
  redeemedAt: string;
  voidedAt: string | null;
}

/** A refusal the database raised by name (VERSION_PUBLISHED, DRAFT_EXISTS, …), for the API to map. */
export class PricingStorageError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PricingStorageError';
  }
}

const CODES = ['VERSION_PUBLISHED', 'DRAFT_EXISTS', 'NO_SUCH_VERSION', 'BACKDATED', 'INVALID_BOOK', 'NO_SUCH_PROMO', 'PROMO_IN_USE', 'NOT_LIVE_BOOK', 'PILOT_MISMATCH', 'NO_SUCH_PACT', 'QUOTE_DOES_NOT_FOOT', 'PROMO_NOT_VALID', 'FORBIDDEN'] as const;

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string; message?: string }; message?: string };
    const message = `${String(failure.message)} ${String(failure.meta?.message ?? '')}`;
    if (/operator required/i.test(message)) throw new OperatorRequiredError();
    const named = CODES.find((code) => new RegExp(`\\b${code}\\b`).test(message));
    if (named) throw new PricingStorageError(named);
    if (/pricing_promos_code_key|promo_codes_code_key/.test(message)) throw new PricingStorageError('PROMO_CODE_TAKEN');
    throw error;
  }
}

/** "5000.000000" → "5000.00" (the currency's places), "5.00" → "5" (basis points and percentages). */
export function decimalText(raw: string | null | undefined, places: number | 'trim'): string | null {
  if (raw === null || raw === undefined) return null;
  const [whole = '0', fraction = ''] = String(raw).split('.');
  if (places === 'trim') {
    const kept = fraction.replace(/0+$/, '');
    return kept ? `${whole}.${kept}` : whole;
  }
  return places > 0 ? `${whole}.${fraction.padEnd(places, '0').slice(0, places)}` : whole;
}

const placesOf = (currency: string) => Math.min(currencyMinorUnits(currency), 6);
const iso = (value: unknown) => (value === null || value === undefined ? null : new Date(value as string).toISOString());

type Json = Record<string, unknown>;

function bookFrom(row: Json): StoredPriceBook {
  const currency = row['currency'] as string;
  const places = placesOf(currency);
  const money = (value: unknown) => decimalText(value as string, places) ?? '0';
  const allowance = (value: Json): PriceBookAllowance => ({ documents: Number(value['documents']), aiBudget: money(value['aiBudget']) });
  return {
    id: row['id'] as string,
    currency,
    version: Number(row['version']),
    status: row['status'] as PriceBookStatus,
    effectiveFrom: iso(row['effectiveFrom']),
    fixedFee: money(row['fixedFee']),
    baseIncludes: allowance(row['baseIncludes'] as Json),
    bands: (row['bands'] as Json[]).map((band) => ({ upTo: band['upTo'] === null ? null : money(band['upTo']), bps: decimalText(band['bps'] as string, 'trim') ?? '0', includes: allowance(band['includes'] as Json) })),
    variableCap: money(row['variableCap']),
    pilotFlat: money(row['pilotFlat']),
    rounding: decimalText(row['rounding'] as string, 'trim') ?? '1',
    basedOnVersionId: (row['basedOnVersionId'] as string | null) ?? null,
    suggestedFrom: (row['suggestedFrom'] as StoredPriceBook['suggestedFrom']) ?? null,
    createdBy: (row['createdBy'] as string | null) ?? null,
    createdAt: iso(row['createdAt']) ?? '',
    publishedBy: (row['publishedBy'] as string | null) ?? null,
    publishedAt: iso(row['publishedAt']),
    firstQuotedAt: iso(row['firstQuotedAt']),
  };
}

function promoFrom(row: Json): PricingPromoRow {
  const currency = (row['currency'] as string | null) ?? null;
  const money = (value: unknown) => (value === null || value === undefined ? null : decimalText(value as string, currency ? placesOf(currency) : 'trim'));
  return {
    id: row['id'] as string,
    code: row['code'] as string,
    description: (row['description'] as string) ?? '',
    effect: row['effect'] as PricingPromoEffect,
    percent: decimalText(row['percent'] as string | null, 'trim'),
    amount: money(row['amount']),
    pilotFlat: money(row['pilotFlat']),
    currency,
    markets: ((row['markets'] as string[] | null) ?? []).map((market) => market.trim()),
    stackable: row['stackable'] === true,
    scope: (row['scope'] as PricingPromoScope) ?? 'ANY',
    organizationIds: (row['organizationIds'] as string[] | null) ?? [],
    validFrom: iso(row['validFrom']) ?? '',
    validUntil: iso(row['validUntil']),
    maxRedemptions: (row['maxRedemptions'] as number | null) ?? null,
    maxPerOrganization: Number(row['maxPerOrganization'] ?? 1),
    status: (row['status'] as PricingPromoStatus) ?? 'ACTIVE',
    createdAt: iso(row['createdAt']) ?? '',
    redemptions: Number(row['redemptions'] ?? 0),
    byMarket: ((row['byMarket'] as Json[] | null) ?? []).map((entry) => ({
      currency: entry['currency'] as string,
      uses: Number(entry['uses']),
      forgone: decimalText(entry['forgone'] as string, placesOf(entry['currency'] as string)) ?? '0',
    })),
  };
}

function quoteFrom(row: Json): StoredQuote {
  const currency = row['currency'] as string;
  const places = placesOf(currency);
  const money = (value: unknown) => decimalText(value as string | null, places);
  return {
    id: row['id'] as string,
    organizationId: row['organizationId'] as string,
    dealId: (row['dealId'] as string | null) ?? null,
    currency,
    bookVersionId: row['bookVersionId'] as string,
    bookVersion: Number(row['bookVersion']),
    variableCap: money(row['variableCap']) ?? '0',
    enterpriseValue: money(row['enterpriseValue']),
    pilot: row['pilot'] === true,
    promoCode: (row['promoCode'] as string | null) ?? null,
    promoId: (row['promoId'] as string | null) ?? null,
    promoRefusal: (row['promoRefusal'] as string | null) ?? null,
    partnerCode: (row['partnerCode'] as string | null) ?? null,
    resellerPercent: decimalText(row['resellerPercent'] as string | null, 'trim'),
    subtotal: money(row['subtotal']) ?? '0',
    total: money(row['total']) ?? '0',
    applied: row['applied'] as QuoteApplied,
    includes: row['includes'] as PriceBookAllowance,
    engineVersion: row['engineVersion'] as string,
    createdBy: row['createdBy'] as string,
    createdAt: iso(row['createdAt']) ?? '',
    expiresAt: iso(row['expiresAt']) ?? '',
    status: row['status'] as QuoteStatus,
    consumedAt: iso(row['consumedAt']),
    lines: ((row['lines'] as Json[] | null) ?? []).map((line) => ({
      kind: line['kind'] as QuoteLineKind,
      from: money(line['from']),
      upTo: money(line['upTo']),
      bps: decimalText(line['bps'] as string | null, 'trim'),
      slice: money(line['slice']),
      percent: decimalText(line['percent'] as string | null, 'trim'),
      amount: money(line['amount']) ?? '0',
      applied: line['applied'] !== false,
    })),
  };
}

/** The book as the database stores it (the engine's shape; effective time is set at publish). */
function bookJson(book: Omit<PriceBook, 'effectiveFrom' | 'version'>): string {
  return JSON.stringify({ currency: book.currency, fixedFee: book.fixedFee, variableCap: book.variableCap, pilotFlat: book.pilotFlat, rounding: book.rounding, baseIncludes: book.baseIncludes, bands: book.bands });
}

function pageOf<T>(rows: Json[], request: PageRequest, map: (row: Json) => T, keyField = 'created_at'): PageResult<T> {
  const page = rows.slice(0, request.limit);
  const last = page.at(-1);
  return {
    items: page.map(map),
    nextCursor: last && rows.length > request.limit ? encodeCursor(new Date(last[keyField] as string), last['id'] as string) : null,
    total: Number(rows[0]?.['total'] ?? 0),
    limit: request.limit,
  };
}

function after(request: PageRequest): { at: Date | null; id: string | null } {
  const position = decodeCursor(request.cursor);
  const at = position && typeof position.key === 'string' ? new Date(position.key) : null;
  return { at, id: at && position ? position.id : null };
}

export const priceBooks = {
  /** The version that prices a quote made now in this market; null when the market has no book. */
  async live(prisma: PrismaClient, currency: string): Promise<StoredPriceBook | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ book: Json | null }[]>`SELECT app_pricing_live_book(${currency}) AS book`);
    return row?.book ? bookFrom(row.book) : null;
  },

  // --- Operators ---------------------------------------------------------------------------------

  async get(prisma: PrismaClient, actor: string, id: string): Promise<StoredPriceBook | null> {
    const [row] = await guarded(() => asApp(prisma, (tx) => tx.$queryRaw<{ book: Json | null }[]>`SELECT app_pricing_book_get(${actor}::uuid, ${id}::uuid) AS book`));
    return row?.book ? bookFrom(row.book) : null;
  },

  /** Version history, newest first, a page at a time (T-126). */
  async page(prisma: PrismaClient, actor: string, currency: string | null, request: PageRequest): Promise<PageResult<StoredPriceBook>> {
    const position = after(request);
    const rows = await guarded(() => asApp(prisma, (tx) =>
      tx.$queryRaw<Json[]>`SELECT book, created_at, id::text, total FROM app_pricing_book_page(${actor}::uuid, ${currency}, ${position.at}::timestamptz, ${position.id}::uuid, ${request.limit + 1}::int)`,
    ));
    return pageOf(rows, request, (row) => bookFrom(row['book'] as Json));
  },

  /** A new draft (one open draft per market), from a book the caller has checked with priceBookProblems. */
  async createDraft(prisma: PrismaClient, actor: string, book: Omit<PriceBook, 'effectiveFrom' | 'version'>, lineage: { basedOnVersionId: string | null; suggestedFrom: StoredPriceBook['suggestedFrom'] }): Promise<string> {
    const [row] = await guarded(() => asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT app_pricing_draft_save(${actor}::uuid, NULL::uuid, ${bookJson(book)}::jsonb, ${lineage.basedOnVersionId}::uuid, ${lineage.suggestedFrom ? JSON.stringify(lineage.suggestedFrom) : null}::jsonb)::text AS id`,
    ));
    if (!row) throw new Error('No id returned');
    return row.id;
  },

  /** Replace a draft. A published version is refused (VERSION_PUBLISHED): make a draft from it instead. */
  async updateDraft(prisma: PrismaClient, actor: string, id: string, book: Omit<PriceBook, 'effectiveFrom' | 'version'>): Promise<void> {
    await guarded(() => asApp(prisma, (tx) => tx.$queryRaw`SELECT app_pricing_draft_save(${actor}::uuid, ${id}::uuid, ${bookJson(book)}::jsonb, NULL::uuid, NULL::jsonb)::text AS id`));
  },

  async discardDraft(prisma: PrismaClient, actor: string, id: string): Promise<boolean> {
    const [row] = await guarded(() => asApp(prisma, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_pricing_draft_discard(${actor}::uuid, ${id}::uuid) AS ok`));
    return row?.ok === true;
  },

  /** Publish a draft: frozen from here on, pricing from `effectiveFrom` (now when null; never earlier). */
  async publish(prisma: PrismaClient, actor: string, id: string, effectiveFrom: Date | null): Promise<StoredPriceBook> {
    const [row] = await guarded(() => asApp(prisma, (tx) => tx.$queryRaw<{ book: Json }[]>`SELECT app_pricing_publish(${actor}::uuid, ${id}::uuid, ${effectiveFrom}::timestamptz) AS book`));
    if (!row) throw new Error('No book returned');
    return bookFrom(row.book);
  },
};

export const pricingPromos = {
  async create(prisma: PrismaClient, actor: string, input: PricingPromoInput): Promise<string> {
    const [row] = await guarded(() => asApp(prisma, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_pricing_promo_create(${actor}::uuid, ${JSON.stringify(input)}::jsonb)::text AS id`));
    if (!row) throw new Error('No id returned');
    return row.id;
  },

  /** Only the fields given change; effect, markets, stacking and scope are frozen once the code has been used. */
  async update(prisma: PrismaClient, actor: string, id: string, changes: Partial<Omit<PricingPromoInput, 'code'>> & { status?: PricingPromoStatus }): Promise<PricingPromoRow> {
    const [row] = await guarded(() => asApp(prisma, (tx) => tx.$queryRaw<{ promo: Json | null }[]>`SELECT app_pricing_promo_update(${actor}::uuid, ${id}::uuid, ${JSON.stringify(changes)}::jsonb) AS promo`));
    if (!row?.promo) throw new PricingStorageError('NO_SUCH_PROMO');
    return promoFrom(row.promo);
  },

  /** Promos, newest first, a page at a time (T-126). */
  async page(prisma: PrismaClient, actor: string, request: PageRequest): Promise<PageResult<PricingPromoRow>> {
    const position = after(request);
    const rows = await guarded(() => asApp(prisma, (tx) =>
      tx.$queryRaw<Json[]>`SELECT promo, created_at, id::text, total FROM app_pricing_promo_page(${actor}::uuid, ${position.at}::timestamptz, ${position.id}::uuid, ${request.limit + 1}::int)`,
    ));
    return pageOf(rows, request, (row) => promoFrom(row['promo'] as Json));
  },

  /** A promo's uses, newest first, a page at a time. */
  async redemptions(prisma: PrismaClient, actor: string, promoId: string, request: PageRequest): Promise<PageResult<PromoRedemptionRow>> {
    const position = after(request);
    const rows = await guarded(() => asApp(prisma, (tx) =>
      tx.$queryRaw<Json[]>`
        SELECT id::text, organization_id::text, organization_name, quote_id::text, deal_id::text, currency, amount_forgone, redeemed_at, voided_at, total
          FROM app_pricing_promo_redemption_page(${actor}::uuid, ${promoId}::uuid, ${position.at}::timestamptz, ${position.id}::uuid, ${request.limit + 1}::int)`,
    ));
    return pageOf(rows, request, (row) => ({
      id: row['id'] as string,
      organizationId: row['organization_id'] as string,
      organizationName: row['organization_name'] as string,
      quoteId: row['quote_id'] as string,
      dealId: row['deal_id'] as string,
      currency: row['currency'] as string,
      amountForgone: decimalText(row['amount_forgone'] as string, placesOf(row['currency'] as string)) ?? '0',
      redeemedAt: iso(row['redeemed_at']) ?? '',
      voidedAt: iso(row['voided_at']),
    }), 'redeemed_at');
  },

  /** Is this code usable by this organization now? Failed checks count toward the per-address limit. */
  async check(prisma: PrismaClient, organizationId: string, code: string, ipHash: string): Promise<PricingPromoCheck> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ result: Json }[]>`SELECT app_pricing_promo_check(${organizationId}::uuid, ${code}, ${ipHash}) AS result`);
    const result = row?.result ?? { reason: 'UNKNOWN' };
    const promo = result['promo'] as Json | undefined;
    return { reason: result['reason'] as PricingPromoReason, promo: promo ? promoFrom({ ...promo, organizationIds: [], byMarket: [] }) : null };
  },
};

export const pactQuotes = {
  /** Store a quote the engine produced; the database re-checks the version, the footing and the promo. */
  async record(prisma: PrismaClient, organizationId: string, actor: string, input: QuoteRecordInput): Promise<string> {
    const [row] = await guarded(() => asApp(prisma, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_pricing_quote_record(${organizationId}::uuid, ${actor}::uuid, ${JSON.stringify(input)}::jsonb)::text AS id`));
    if (!row) throw new Error('No id returned');
    return row.id;
  },

  /** A stored quote, only to its own organization; null for anyone else. */
  async get(prisma: PrismaClient, organizationId: string, id: string): Promise<StoredQuote | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ quote: Json | null }[]>`SELECT app_pricing_quote_get(${organizationId}::uuid, ${id}::uuid) AS quote`);
    return row?.quote ? quoteFrom(row.quote) : null;
  },

  /** The pact is bought on this quote: its promo is counted now, under its caps (T-177c wires checkout to it). */
  async consume(prisma: PrismaClient, organizationId: string, id: string, dealId: string): Promise<QuoteConsumeResult> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ result: QuoteConsumeResult }[]>`SELECT app_pricing_quote_consume(${organizationId}::uuid, ${id}::uuid, ${dealId}::uuid) AS result`);
    return row?.result ?? 'UNKNOWN';
  },
};
