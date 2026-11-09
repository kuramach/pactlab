import { z } from 'zod';

/** Billing (T-087, ADR 0025): what the app shows. Money as decimal strings with currency. */

export type BillingPlanKey = 'PACT' | 'TEAM_ANNUAL' | 'TEAM_MONTHLY' | 'VENTURE_MONTHLY' | 'VENTURE_ANNUAL' | 'VENTURE_ROUND' | 'FIRM_ANNUAL' | 'SELL_SIDE';

export interface BillingPlanView {
  key: BillingPlanKey;
  name: string;
  summary: string;
  price: { amount: string; currency: string; interval: 'month' | 'year' | null };
  pactsIncluded: number | null;
  overage: { amount: string; currency: string } | null;
  grants: 'PACT' | 'VENTURE_ROUND' | 'SELL_SIDE';
}

export interface BillingView {
  status: 'NONE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  pilot: boolean;
  plan: { key: string; name: string } | null;
  periodEnd: string | null;
  /** Subscription pacts left this period (null: no subscription, or unlimited). */
  allowanceLeft: number | null;
  credits: { kind: 'PACT' | 'VENTURE_ROUND' | 'SELL_SIDE'; packs: string[]; source: 'PURCHASE' | 'COMP' | 'PROMO' }[];
  /** A redeemed discount code waiting for the next checkout. */
  pendingPromo: string | null;
  /** Whether starting a pact is gated at all in this environment. */
  enforced: boolean;
  canManage: boolean;
  hasCustomer: boolean;
  plans: BillingPlanView[];
}

export const checkoutBodySchema = z.strictObject({ plan: z.enum(['PACT', 'TEAM_ANNUAL', 'TEAM_MONTHLY', 'VENTURE_MONTHLY', 'VENTURE_ANNUAL', 'VENTURE_ROUND', 'FIRM_ANNUAL', 'SELL_SIDE']) });
export const promoCodeBodySchema = z.strictObject({ code: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9-]+$/) });

/** A promo code check: whether it works, and what it gives, in words. */
export interface PromoCheckView {
  valid: boolean;
  reason: 'OK' | 'UNKNOWN' | 'INACTIVE' | 'NOT_YET' | 'EXPIRED' | 'USED_UP' | 'RATE_LIMITED';
  /** e.g. "2 free pacts (Multifamily)" or "50% off for 12 months". */
  summary: string | null;
  skipsApproval: boolean;
}

const decimal = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/);
const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date());

/** Operators create promo codes (Admin → Promo codes). */
export const createPromoCodeSchema = z
  .strictObject({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,40}$/),
    description: z.string().trim().min(1).max(200),
    kind: z.enum(['DISCOUNT', 'FREE_PACTS']),
    percentOff: decimal.nullable().default(null),
    amountOff: decimal.nullable().default(null),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
    duration: z.enum(['ONCE', 'REPEATING', 'FOREVER']).nullable().default(null),
    durationMonths: z.number().int().min(1).max(36).nullable().default(null),
    planKeys: z.array(checkoutBodySchema.shape.plan).max(8).default([]),
    freePacts: z.number().int().min(1).max(100).nullable().default(null),
    packs: z.array(z.string().regex(/^[A-Z_]{2,40}$/)).max(14).default([]),
    validFrom: isoDate.nullable().default(null),
    validUntil: isoDate.nullable().default(null),
    maxRedemptions: z.number().int().min(1).max(100_000).nullable().default(null),
    skipsApproval: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'FREE_PACTS' && !value.freePacts) ctx.addIssue({ code: 'custom', path: ['freePacts'], message: 'How many free pacts?' });
    if (value.kind === 'DISCOUNT') {
      if (!value.percentOff === !value.amountOff) ctx.addIssue({ code: 'custom', path: ['percentOff'], message: 'Give a percent or an amount off, not both.' });
      if (value.percentOff && (Number(value.percentOff) <= 0 || Number(value.percentOff) > 100)) ctx.addIssue({ code: 'custom', path: ['percentOff'], message: 'Between 0 and 100.' });
      if (value.amountOff && !value.currency) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Currency for an amount off.' });
      if (!value.duration) ctx.addIssue({ code: 'custom', path: ['duration'], message: 'For how long?' });
      if ((value.duration === 'REPEATING') !== Boolean(value.durationMonths)) ctx.addIssue({ code: 'custom', path: ['durationMonths'], message: 'Months only for a repeating discount.' });
    }
  });
export type CreatePromoCodeInput = z.infer<typeof createPromoCodeSchema>;

export interface PromoCodeView extends Omit<CreatePromoCodeInput, 'validFrom' | 'validUntil'> {
  id: string;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
  redemptions: number;
  summary: string;
  stripeLinked: boolean;
  createdAt: string;
}

export interface AdminBillingAccountView {
  organizationId: string;
  planKey: string | null;
  status: BillingView['status'];
  periodEnd: string | null;
  pactsUsed: number;
  openCredits: number;
}
