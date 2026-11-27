import { priceBookProblems, type CheckoutPrice, type PactQuote } from '@pactlab/domain';
import { z } from 'zod';
import { pageQuerySchema } from './pagination';

/**
 * The per-deal price book (T-177): what the admin console edits and checkout quotes from. Amounts are
 * decimal strings in the book's currency; the domain's checks (bands ascend, bps bounds, a positive cap,
 * amounts the currency can hold) run on every book that enters the API.
 */
const amount = z.string().trim().regex(/^\d{1,15}(\.\d{1,6})?$/, 'A plain amount, like 5000 or 5000.00.');
const allowanceSchema = z.strictObject({ documents: z.number().int().min(0).max(1_000_000), aiBudget: amount });

export const priceBookSchema = z
  .strictObject({
    currency: z.string().regex(/^[A-Z]{3}$/),
    version: z.number().int().min(1),
    effectiveFrom: z.iso.datetime({ offset: true }),
    fixedFee: amount,
    baseIncludes: allowanceSchema,
    bands: z.array(z.strictObject({ upTo: amount.nullable(), bps: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/), includes: allowanceSchema })).min(1).max(10),
    variableCap: amount,
    pilotFlat: amount,
    rounding: amount,
  })
  .superRefine((book, ctx) => {
    for (const problem of priceBookProblems(book)) ctx.addIssue({ code: 'custom', path: problem.path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)), message: problem.message });
  });
export type PriceBookInput = z.infer<typeof priceBookSchema>;

/** A pact quote: enterprise value as declared at purchase, in the pact's own currency. */
export const pactQuoteRequestSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  enterpriseValue: amount.nullable(),
  partnerCode: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9-]+$/).nullable().default(null),
  promoCode: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9-]+$/).nullable().default(null),
});
export type PactQuoteRequest = z.infer<typeof pactQuoteRequestSchema>;

/** What checkout shows: the quote itemized, and each code's effect apart (Partner code, Promo code). */
export interface PactQuoteView {
  quote: PactQuote;
  price: CheckoutPrice;
}

// --- Storage (T-177a, ADR 0061) -------------------------------------------------------------------

const currency = z.string().regex(/^[A-Z]{3}$/);
const bookBody = z.strictObject({
  currency,
  fixedFee: amount,
  baseIncludes: allowanceSchema,
  bands: z.array(z.strictObject({ upTo: amount.nullable(), bps: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/), includes: allowanceSchema })).min(1).max(10),
  variableCap: amount,
  pilotFlat: amount,
  rounding: amount,
});

/** A draft's book: the stored shape without a version (counted by the database) or an effective time (set at publish). */
export const priceBookDraftBodySchema = bookBody.superRefine((book, ctx) => {
  for (const problem of priceBookProblems({ ...book, version: 1, effectiveFrom: '2026-01-01T00:00:00Z' })) {
    ctx.addIssue({ code: 'custom', path: problem.path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)), message: problem.message });
  }
});
export type PriceBookDraftBody = z.infer<typeof priceBookDraftBodySchema>;

/** A new draft: a copy of a version of the same market, a typed book, or a suggested conversion of another market's version. */
export const createPriceBookDraftSchema = z.union([
  z.strictObject({ fromVersionId: z.uuid() }),
  z.strictObject({ book: priceBookDraftBodySchema, basedOnVersionId: z.uuid().nullable().default(null) }),
  z.strictObject({ suggest: z.strictObject({ fromVersionId: z.uuid(), currency, rate: amount, rateDate: z.iso.date(), rounding: amount }) }),
]);
export type CreatePriceBookDraft = z.infer<typeof createPriceBookDraftSchema>;

export const updatePriceBookDraftSchema = z.strictObject({ book: priceBookDraftBodySchema });
export const publishPriceBookSchema = z.strictObject({ effectiveFrom: z.iso.datetime({ offset: true }).nullable().default(null) });
export const previewPriceBookSchema = z.strictObject({ enterpriseValues: z.array(amount).min(1).max(10) });
export const priceBooksQuerySchema = z.strictObject({ currency: currency.optional() }).extend(pageQuerySchema.shape);

/** A stored version (operators see drafts and history; organizations only the live one). */
export interface PriceBookVersionView extends Omit<PriceBookInput, 'effectiveFrom'> {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  effectiveFrom: string | null;
  basedOnVersionId: string | null;
  suggestedFrom: { currency: string; version: number; rate: string; rateDate: string } | null;
  createdAt: string;
  publishedAt: string | null;
  firstQuotedAt: string | null;
}

/** Quotes of sample sizes against a draft and the live version, before publishing. */
export interface PriceBookPreviewView {
  draft: PactQuote[];
  live: PactQuote[] | null;
}

export const PRICING_PROMO_EFFECTS = ['PERCENT_TOTAL', 'PERCENT_FIXED', 'AMOUNT_OFF', 'WAIVE_VARIABLE', 'PILOT_FLAT'] as const;
const promoCode = z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9-]+$/).transform((code) => code.toUpperCase());
const percent = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/).refine((value) => Number(value) > 0 && Number(value) <= 100, 'Above 0 and at most 100.');
const promoEffectFields = {
  effect: z.enum(PRICING_PROMO_EFFECTS),
  percent: percent.nullable().default(null),
  amount: amount.nullable().default(null),
  pilotFlat: amount.nullable().default(null),
  currency: currency.nullable().default(null),
};

/** Each effect carries exactly what it needs; an amount is in one currency, so its code is valid only in that market. */
function checkEffect(promo: { effect: (typeof PRICING_PROMO_EFFECTS)[number]; percent: string | null; amount: string | null; pilotFlat: string | null; currency: string | null; markets?: string[] | undefined }, ctx: z.RefinementCtx) {
  const need = (field: 'percent' | 'amount' | 'pilotFlat' | 'currency', wanted: boolean) => {
    if (wanted && promo[field] === null) ctx.addIssue({ code: 'custom', path: [field], message: 'Required for this effect.' });
    if (!wanted && promo[field] !== null) ctx.addIssue({ code: 'custom', path: [field], message: 'Not used by this effect.' });
  };
  const percentage = promo.effect === 'PERCENT_TOTAL' || promo.effect === 'PERCENT_FIXED';
  need('percent', percentage);
  need('amount', promo.effect === 'AMOUNT_OFF');
  need('pilotFlat', promo.effect === 'PILOT_FLAT');
  need('currency', promo.effect === 'AMOUNT_OFF' || promo.effect === 'PILOT_FLAT');
  if (promo.currency && promo.markets !== undefined && (promo.markets.length !== 1 || promo.markets[0] !== promo.currency)) {
    ctx.addIssue({ code: 'custom', path: ['markets'], message: `An amount in ${promo.currency} is valid only in that market.` });
  }
}

export const createPricingPromoSchema = z
  .strictObject({
    code: promoCode,
    description: z.string().trim().min(1).max(200),
    ...promoEffectFields,
    markets: z.array(currency).max(10).default([]),
    stackable: z.boolean().default(false),
    scope: z.enum(['ANY', 'PILOT_ONLY', 'ORGANIZATIONS']).default('ANY'),
    organizationIds: z.array(z.uuid()).max(100).default([]),
    validFrom: z.iso.datetime({ offset: true }).nullable().default(null),
    validUntil: z.iso.datetime({ offset: true }).nullable().default(null),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
    maxPerOrganization: z.number().int().min(1).max(1000).default(1),
  })
  .superRefine((promo, ctx) => {
    checkEffect(promo, ctx);
    if ((promo.scope === 'ORGANIZATIONS') !== promo.organizationIds.length > 0) ctx.addIssue({ code: 'custom', path: ['organizationIds'], message: 'Name the organizations exactly when the scope is ORGANIZATIONS.' });
    if (promo.validFrom && promo.validUntil && Date.parse(promo.validUntil) <= Date.parse(promo.validFrom)) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'After it starts.' });
  });
export type CreatePricingPromo = z.infer<typeof createPricingPromoSchema>;

/** Status, window, caps and description change any time; the effect only while the code is unused (the database refuses otherwise). */
export const updatePricingPromoSchema = z
  .strictObject({
    description: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'EXPIRED']).optional(),
    validFrom: z.iso.datetime({ offset: true }).optional(),
    validUntil: z.iso.datetime({ offset: true }).nullable().optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxPerOrganization: z.number().int().min(1).max(1000).optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'Change at least one field.');
export type UpdatePricingPromo = z.infer<typeof updatePricingPromoSchema>;

export interface PricingPromoView extends Omit<CreatePricingPromo, 'validFrom'> {
  id: string;
  validFrom: string;
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED';
  createdAt: string;
  redemptions: number;
  /** Uses and revenue forgone per market, never summed across currencies. */
  byMarket: { currency: string; uses: number; forgone: string }[];
}

export interface PricingPromoRedemptionView {
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

/** A quote to store: the request, optionally for a pact that already exists. */
export const pactQuoteCreateSchema = pactQuoteRequestSchema.extend({ dealId: z.uuid().nullable().default(null) });
export type PactQuoteCreate = z.infer<typeof pactQuoteCreateSchema>;

/** A stored quote, re-shown from its lines: it keeps its version's price for 30 days. */
export interface StoredPactQuoteView extends PactQuoteView {
  id: string;
  dealId: string | null;
  bookVersionId: string;
  status: 'OPEN' | 'CONSUMED' | 'EXPIRED' | 'VOIDED';
  createdAt: string;
  expiresAt: string;
  engineVersion: string;
}
