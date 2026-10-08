import { COMPANY_TYPES, CONNECT_METHODS, OWNERSHIPS, PARTY_ROLES, SOURCE_KINDS } from '@pactlab/domain';
import { z } from 'zod';
import { isoCurrencySchema } from './common';
import { transactionTypeSchema } from './deals';

/** Blank form fields arrive as ''; treat them as absent. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().default(null),
  );

const partyFields = {
  name: z.string().trim().min(1).max(200),
  ownership: z.enum(OWNERSHIPS),
  ticker: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value),
    z.string().regex(/^[A-Z0-9.-]{1,12}$/, 'Ticker symbol').nullable().default(null),
  ),
  exchange: optionalText(40),
  website: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.url({ protocol: /^https?$/ }).max(300).nullable().default(null),
  ),
  companyType: z.enum(COMPANY_TYPES).nullable().default(null),
};

/** A public company is named by its ticker; a private one has none. */
function listing<T extends { ownership: string; ticker: string | null; exchange: string | null }>(party: T): T {
  return party.ownership === 'PRIVATE' ? { ...party, ticker: null, exchange: null } : party;
}

const requireTicker = (party: { ownership: string; ticker: string | null }, ctx: z.RefinementCtx) => {
  if (party.ownership === 'PUBLIC' && !party.ticker) {
    ctx.addIssue({ code: 'custom', path: ['ticker'], message: 'A public company needs its ticker' });
  }
};

export const partyInputSchema = z.strictObject(partyFields).superRefine(requireTicker).transform(listing);
export type PartyInput = z.infer<typeof partyInputSchema>;

export const startPactSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    baseCurrency: isoCurrencySchema.default('USD'),
    buyer: partyInputSchema,
    seller: partyInputSchema,
  })
  .superRefine((pact, ctx) => {
    if (!pact.seller.companyType) {
      ctx.addIssue({ code: 'custom', path: ['seller', 'companyType'], message: 'Say what kind of company the seller is' });
    }
  });
export type StartPactCommand = z.infer<typeof startPactSchema>;

export const updatePartySchema = z
  .strictObject({
    name: partyFields.name.optional(),
    ownership: partyFields.ownership.optional(),
    ticker: partyFields.ticker.optional(),
    exchange: partyFields.exchange.optional(),
    website: partyFields.website.optional(),
    companyType: z.enum(COMPANY_TYPES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
export type UpdatePartyCommand = z.infer<typeof updatePartySchema>;

export const partyParamsSchema = z.strictObject({
  dealId: z.uuid(),
  role: z.enum(PARTY_ROLES).or(z.enum(['buyer', 'seller']).transform((role) => role.toUpperCase() as 'BUYER' | 'SELLER')),
});

export const dealPartySchema = z.object({
  role: z.enum(PARTY_ROLES),
  name: z.string(),
  ownership: z.enum(OWNERSHIPS),
  ticker: z.string().nullable(),
  exchange: z.string().nullable(),
  website: z.string().nullable(),
  companyType: z.enum(COMPANY_TYPES).nullable(),
  updatedAt: z.iso.datetime(),
});
export type DealPartyView = z.infer<typeof dealPartySchema>;

export const dealPartiesResponseSchema = z.object({
  items: z.array(dealPartySchema),
  /** What the parties' ownership implies now; differs from the deal's fixed type after a correction. */
  derivedTransactionType: transactionTypeSchema.nullable(),
  transactionType: transactionTypeSchema,
});
export type DealPartiesResponse = z.infer<typeof dealPartiesResponseSchema>;

export const sourcePlanItemSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  label: z.string(),
  provider: z.string(),
  providerLabel: z.string(),
  why: z.string(),
  produces: z.string(),
  upload: z.object({ format: z.enum(['CSV', 'FILES']), label: z.string() }),
  methods: z.array(z.object({ method: z.enum(CONNECT_METHODS), availability: z.enum(['AVAILABLE', 'NEXT']) })),
  /** Existing connections that feed this source. */
  connections: z.array(
    z.object({
      id: z.uuid(),
      provider: z.string(),
      displayName: z.string(),
      mode: z.enum(['FIXTURE', 'LIVE']),
      lastSyncStatus: z.string().nullable(),
    }),
  ),
  status: z.enum(['NOT_CONNECTED', 'CONNECTED']),
});

export const sourcePlanResponseSchema = z.object({
  /** Null when the deal predates Pacts and nobody has described the seller. */
  companyType: z.enum(COMPANY_TYPES).nullable(),
  packAvailable: z.boolean(),
  note: z.string().nullable(),
  sources: z.array(sourcePlanItemSchema),
});
export type SourcePlanResponse = z.infer<typeof sourcePlanResponseSchema>;
