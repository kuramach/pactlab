import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CreatePriceBookDraft,
  CreatePricingPromo,
  Page,
  PactQuoteCreate,
  PriceBookDraftBody,
  PriceBookPreviewView,
  PriceBookVersionView,
  PricingPromoRedemptionView,
  PricingPromoView,
  StoredPactQuoteView,
  UpdatePricingPromo,
} from '@pactlab/contracts';
import { billing, OperatorRequiredError, pactQuotes, PricingStorageError, priceBooks, pricingPromos, type PrismaClient, type PricingPromoRow, type StoredPriceBook, type StoredQuote } from '@pactlab/db';
import {
  checkoutPromo,
  priceBookProblems,
  priceCheckout,
  PRICING_ENGINE_VERSION,
  quoteLines,
  quotePact,
  reshowQuote,
  suggestConvertedBook,
  type CheckoutPromo,
  type PriceBook,
  type TenantContext,
} from '@pactlab/domain';
import { keyedHash } from '../email-login/client-address';
import { PRISMA } from '../tokens';

export const PACT_PRICING = Symbol('PACT_PRICING');

export interface PactPricingDependencies {
  /** Keys the promo-check address hashes (shared with T-087's promo checks, so one limit covers both). */
  readonly hashSecret: string;
}

/** HTTP for each refusal the database raises by name: 422 with the rule's code (the API's rule-failure status). */
function httpError(error: unknown): never {
  if (error instanceof OperatorRequiredError) throw new ForbiddenException();
  if (!(error instanceof PricingStorageError)) throw error;
  switch (error.code) {
    case 'VERSION_PUBLISHED':
      throw new UnprocessableEntityException({ code: 'VERSION_PUBLISHED', detail: 'A published version never changes. Create a draft from it (POST /v1/admin/pricing/books/drafts with fromVersionId) and publish that as the next version.' });
    case 'DRAFT_EXISTS':
      throw new UnprocessableEntityException({ code: 'DRAFT_EXISTS', detail: 'This market already has an open draft: edit or discard it first.' });
    case 'NOT_LIVE_BOOK':
    case 'PILOT_MISMATCH':
      throw new UnprocessableEntityException({ code: error.code, detail: 'The price book or pilot status changed while quoting. Quote again.' });
    case 'NO_SUCH_VERSION':
    case 'NO_SUCH_PROMO':
    case 'NO_SUCH_PACT':
      throw new NotFoundException({ code: error.code });
    case 'FORBIDDEN':
      throw new ForbiddenException();
    default:
      throw new UnprocessableEntityException({ code: error.code });
  }
}

async function mapped<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    return httpError(error);
  }
}

/** The engine's book from a stored version; a draft quotes as if it were live now (previews only). */
function engineBook(stored: StoredPriceBook): PriceBook {
  return {
    currency: stored.currency,
    version: stored.version,
    effectiveFrom: stored.effectiveFrom ?? new Date().toISOString(),
    fixedFee: stored.fixedFee,
    baseIncludes: stored.baseIncludes,
    bands: stored.bands,
    variableCap: stored.variableCap,
    pilotFlat: stored.pilotFlat,
    rounding: stored.rounding,
  };
}

function versionView(stored: StoredPriceBook): PriceBookVersionView {
  return {
    id: stored.id,
    currency: stored.currency,
    version: stored.version,
    status: stored.status,
    effectiveFrom: stored.effectiveFrom,
    fixedFee: stored.fixedFee,
    baseIncludes: stored.baseIncludes,
    bands: stored.bands,
    variableCap: stored.variableCap,
    pilotFlat: stored.pilotFlat,
    rounding: stored.rounding,
    basedOnVersionId: stored.basedOnVersionId,
    suggestedFrom: stored.suggestedFrom,
    createdAt: stored.createdAt,
    publishedAt: stored.publishedAt,
    firstQuotedAt: stored.firstQuotedAt,
  };
}

function promoView(row: PricingPromoRow): PricingPromoView {
  return { ...row };
}

function quoteView(stored: StoredQuote): StoredPactQuoteView {
  return {
    ...reshowQuote(stored),
    id: stored.id,
    dealId: stored.dealId,
    bookVersionId: stored.bookVersionId,
    status: stored.status,
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    engineVersion: stored.engineVersion,
  };
}

/**
 * Pact pricing storage (T-177a, ADR 0061): versioned price books per market, pact promo codes and
 * stored quotes. The engine (packages/domain/src/pricing) does every sum; the database stores what
 * it produced, re-checks it, freezes a version at publish and audits every change.
 */
@Injectable()
export class PactPricingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PACT_PRICING) private readonly deps: PactPricingDependencies,
  ) {}

  // --- Organizations ----------------------------------------------------------------------------

  /** The version that prices a quote made now in this market. */
  async liveBook(currency: string): Promise<PriceBookVersionView> {
    const live = await priceBooks.live(this.prisma, currency);
    if (!live) throw new NotFoundException({ code: 'NO_PRICE_BOOK' });
    return versionView(live);
  }

  /** Quote a pact off the live book and store it; owners and admins only (Kumar, decision 5). */
  async quote(tenant: TenantContext, request: PactQuoteCreate, ip: string): Promise<StoredPactQuoteView> {
    if (tenant.organizationRole !== 'ORG_OWNER' && tenant.organizationRole !== 'ORG_ADMIN') throw new ForbiddenException();
    const live = await priceBooks.live(this.prisma, request.currency);
    if (!live) throw new UnprocessableEntityException({ code: 'NO_PRICE_BOOK', detail: `There is no ${request.currency} price book yet.` });
    // Pilot is the organization's flag, decided here, never taken from the request.
    const pilot = (await billing.state(this.prisma, tenant.organizationId, tenant.userId))?.pilot ?? false;

    let promo: CheckoutPromo | null = null;
    let promoId: string | null = null;
    if (request.promoCode) {
      const checked = await pricingPromos.check(this.prisma, tenant.organizationId, request.promoCode, keyedHash(this.deps.hashSecret, `promo-ip:${ip}`));
      if (checked.reason !== 'OK' || !checked.promo) throw new UnprocessableEntityException({ code: `PROMO_${checked.reason}` });
      promo = checkoutPromo(checked.promo);
      promoId = checked.promo.id;
    }

    const book = engineBook(live);
    const quote = quotePact(book, { enterpriseValue: pilot ? null : request.enterpriseValue, pilot });
    // Reseller codes are T-093's: the code is kept as typed, with no discount until then.
    const price = priceCheckout(quote, { promo, resellerPercent: null }, book.rounding);
    const id = await mapped(() =>
      pactQuotes.record(this.prisma, tenant.organizationId, tenant.userId, {
        versionId: live.id,
        currency: live.currency,
        enterpriseValue: quote.enterpriseValue,
        pilot,
        promoCode: promo?.code ?? null,
        promoId,
        promoRefusal: price.promo?.refusal ?? null,
        partnerCode: request.partnerCode,
        resellerPercent: null,
        subtotal: quote.total,
        total: price.total,
        applied: price.applied,
        includes: quote.includes,
        dealId: request.dealId,
        engineVersion: PRICING_ENGINE_VERSION,
        lines: quoteLines(quote, price),
      }),
    );
    return this.storedQuote(tenant, id);
  }

  /** A stored quote, re-shown from its lines; another organization's is not found. */
  async storedQuote(tenant: TenantContext, id: string): Promise<StoredPactQuoteView> {
    const stored = await pactQuotes.get(this.prisma, tenant.organizationId, id);
    if (!stored) throw new NotFoundException();
    return quoteView(stored);
  }

  // --- Operators: books ------------------------------------------------------------------------

  async books(tenant: TenantContext, currency: string | null, request: { cursor?: string | undefined; limit: number }): Promise<Page<PriceBookVersionView>> {
    const page = await mapped(() => priceBooks.page(this.prisma, tenant.userId, currency, request));
    return { ...page, items: page.items.map(versionView) };
  }

  private async version(tenant: TenantContext, id: string): Promise<StoredPriceBook> {
    const stored = await mapped(() => priceBooks.get(this.prisma, tenant.userId, id));
    if (!stored) throw new NotFoundException({ code: 'NO_SUCH_VERSION' });
    return stored;
  }

  private static checked(book: PriceBookDraftBody): PriceBookDraftBody {
    const problems = priceBookProblems({ ...book, version: 1, effectiveFrom: new Date().toISOString() });
    if (problems.length > 0) throw new UnprocessableEntityException({ code: 'INVALID_BOOK', problems });
    return book;
  }

  /** A draft from a version of the same market, a typed book, or a suggested conversion (rate and date kept). */
  async createDraft(tenant: TenantContext, input: CreatePriceBookDraft): Promise<PriceBookVersionView> {
    let book: PriceBookDraftBody;
    let basedOnVersionId: string | null = null;
    let suggestedFrom: StoredPriceBook['suggestedFrom'] = null;
    if ('fromVersionId' in input) {
      const source = await this.version(tenant, input.fromVersionId);
      book = source;
      basedOnVersionId = source.id;
    } else if ('suggest' in input) {
      const source = await this.version(tenant, input.suggest.fromVersionId);
      if (source.currency === input.suggest.currency) throw new UnprocessableEntityException({ code: 'SAME_MARKET', detail: 'Copy the version instead of converting it.' });
      const suggested = suggestConvertedBook(engineBook(source), { ...input.suggest, effectiveFrom: new Date().toISOString() });
      book = suggested.book;
      suggestedFrom = suggested.suggestedFrom;
    } else {
      book = input.book;
      basedOnVersionId = input.basedOnVersionId;
    }
    const id = await mapped(() => priceBooks.createDraft(this.prisma, tenant.userId, PactPricingService.checked(book), { basedOnVersionId, suggestedFrom }));
    return versionView(await this.version(tenant, id));
  }

  /** Edit a draft. A published version (one that may have quoted) is refused with VERSION_PUBLISHED. */
  async updateDraft(tenant: TenantContext, id: string, book: PriceBookDraftBody): Promise<PriceBookVersionView> {
    const stored = await this.version(tenant, id);
    if (stored.currency !== book.currency) throw new UnprocessableEntityException({ code: 'WRONG_MARKET', detail: 'A version keeps its market.' });
    await mapped(() => priceBooks.updateDraft(this.prisma, tenant.userId, id, PactPricingService.checked(book)));
    return versionView(await this.version(tenant, id));
  }

  async discardDraft(tenant: TenantContext, id: string): Promise<{ discarded: boolean }> {
    const discarded = await mapped(() => priceBooks.discardDraft(this.prisma, tenant.userId, id));
    if (!discarded) throw new NotFoundException({ code: 'NO_SUCH_VERSION' });
    return { discarded };
  }

  /** Publish: frozen from here on; it prices fresh quotes from `effectiveFrom` with no deploy. */
  async publish(tenant: TenantContext, id: string, effectiveFrom: string | null): Promise<PriceBookVersionView> {
    const stored = await this.version(tenant, id);
    PactPricingService.checked(stored);
    return versionView(await mapped(() => priceBooks.publish(this.prisma, tenant.userId, id, effectiveFrom ? new Date(effectiveFrom) : null)));
  }

  /** Sample sizes against a draft and the market's live version, for the operator to compare before publishing. */
  async preview(tenant: TenantContext, id: string, enterpriseValues: readonly string[]): Promise<PriceBookPreviewView> {
    const draft = await this.version(tenant, id);
    const live = await priceBooks.live(this.prisma, draft.currency);
    const quotes = (stored: StoredPriceBook) => enterpriseValues.map((enterpriseValue) => quotePact(engineBook(stored), { enterpriseValue }));
    return { draft: quotes(draft), live: live ? quotes(live) : null };
  }

  // --- Operators: promos -----------------------------------------------------------------------

  async promos(tenant: TenantContext, request: { cursor?: string | undefined; limit: number }): Promise<Page<PricingPromoView>> {
    const page = await mapped(() => pricingPromos.page(this.prisma, tenant.userId, request));
    return { ...page, items: page.items.map(promoView) };
  }

  async createPromo(tenant: TenantContext, input: CreatePricingPromo): Promise<PricingPromoView> {
    const id = await mapped(() => pricingPromos.create(this.prisma, tenant.userId, input));
    // An update with no changes reads the promo back and records nothing.
    return promoView(await mapped(() => pricingPromos.update(this.prisma, tenant.userId, id, {})));
  }

  async updatePromo(tenant: TenantContext, id: string, changes: UpdatePricingPromo): Promise<PricingPromoView> {
    return promoView(await mapped(() => pricingPromos.update(this.prisma, tenant.userId, id, changes)));
  }

  async redemptions(tenant: TenantContext, id: string, request: { cursor?: string | undefined; limit: number }): Promise<Page<PricingPromoRedemptionView>> {
    return mapped(() => pricingPromos.redemptions(this.prisma, tenant.userId, id, request));
  }
}
