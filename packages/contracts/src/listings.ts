import { z } from 'zod';

/**
 * Public deal pages (listings): a seller-written teaser at an unguessable link, the
 * requests for access interested buyers leave, and the seller's decision on each.
 */
const amount = z.string().trim().regex(/^\d{1,18}(\.\d{1,2})?$/, 'A positive amount, up to 2 decimals');
const optionalText = (max: number) => z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), z.string().trim().max(max).nullable().default(null));

export const LISTING_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;
export const LISTING_VISIBILITIES = ['ANONYMOUS', 'NAMED'] as const;
export const INTEREST_INTENTS = ['STRATEGIC', 'FINANCIAL', 'INDIVIDUAL', 'ADVISER'] as const;
export const INTEREST_STATUSES = ['NEW', 'APPROVED', 'DECLINED'] as const;

export const listingSlugSchema = z.string().regex(/^pl-[a-z0-9]{10}$/);
export const listingSlugParamsSchema = z.strictObject({ slug: listingSlugSchema });
export const listingParamsSchema = z.strictObject({ dealId: z.uuid() });
export const listingInterestParamsSchema = z.strictObject({ dealId: z.uuid(), interestId: z.uuid() });

/** The seller's teaser. Everything here becomes public once published: no evidence, no figures from the pact. */
export const saveListingSchema = z
  .strictObject({
    visibility: z.enum(LISTING_VISIBILITIES),
    codename: z.string().trim().min(1).max(80),
    /** Shown only when visibility is NAMED. */
    publicName: optionalText(160),
    headline: z.string().trim().min(1).max(160),
    sector: optionalText(80),
    region: optionalText(80),
    sizeBand: optionalText(80),
    askingLow: amount.nullable().default(null),
    askingHigh: amount.nullable().default(null),
    askingCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
    summary: z.string().trim().max(2000).default(''),
    highlights: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
    indexable: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.visibility === 'NAMED' && !value.publicName) ctx.addIssue({ code: 'custom', path: ['publicName'], message: 'A named page shows a company name' });
    const asking = [value.askingLow, value.askingCurrency];
    if (asking.some((part) => part !== null) && asking.some((part) => part === null)) ctx.addIssue({ code: 'custom', path: ['askingLow'], message: 'An asking range needs a low amount and a currency' });
    if (value.askingHigh !== null && value.askingLow === null) ctx.addIssue({ code: 'custom', path: ['askingHigh'], message: 'An asking range needs a low amount' });
    if (value.askingHigh !== null && value.askingLow !== null && Number(value.askingHigh) < Number(value.askingLow)) ctx.addIssue({ code: 'custom', path: ['askingHigh'], message: 'The high amount is below the low one' });
  });
export type SaveListingBody = z.infer<typeof saveListingSchema>;

export const listingStatusSchema = z.strictObject({ status: z.enum(LISTING_STATUSES) });
export type ListingStatusBody = z.infer<typeof listingStatusSchema>;

/** A signed-out visitor's request for access. `website` is a honeypot: humans leave it empty. */
export const listingInterestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  firm: z.string().trim().min(1).max(200),
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  intent: z.enum(INTEREST_INTENTS),
  message: optionalText(1000),
  website: z.string().max(200).optional(),
});
export type ListingInterestBody = z.infer<typeof listingInterestSchema>;

export const confirmListingInterestSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/) });

export const declineListingInterestSchema = z.strictObject({ note: optionalText(1000) });
export type DeclineListingInterestBody = z.infer<typeof declineListingInterestSchema>;

/** What anyone with the link sees. */
export interface PublicListingView {
  slug: string;
  visibility: (typeof LISTING_VISIBILITIES)[number];
  codename: string;
  publicName: string | null;
  headline: string;
  sector: string | null;
  region: string | null;
  sizeBand: string | null;
  asking: { low: string; high: string | null; currency: string } | null;
  summary: string;
  highlights: string[];
  indexable: boolean;
  publishedAt: string | null;
}

/** The seller's own view of their page. */
export interface ListingView extends Omit<PublicListingView, 'publishedAt'> {
  id: string;
  status: (typeof LISTING_STATUSES)[number];
  publishedAt: string | null;
  updatedAt: string;
}

export interface ListingInterestView {
  id: string;
  name: string;
  firm: string;
  email: string;
  intent: (typeof INTEREST_INTENTS)[number];
  message: string | null;
  status: (typeof INTEREST_STATUSES)[number];
  confirmedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  bidId: string | null;
}
