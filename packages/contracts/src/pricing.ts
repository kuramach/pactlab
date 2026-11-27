import { priceBookProblems, type CheckoutPrice, type PactQuote } from '@pactlab/domain';
import { z } from 'zod';

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
