import { asApp } from './auth-role';
import type { PrismaClient, TransactionClient } from './client';
import { OperatorRequiredError } from './ops';

/**
 * Billing and promo-code state (T-087, ADR 0025), behind pactlab_billing SECURITY DEFINER
 * functions. Money amounts come back as decimal strings, never floats.
 */

export type PactCreditKind = 'PACT' | 'VENTURE_ROUND' | 'SELL_SIDE';
export type BillingStatus = 'NONE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
export type PactPayment = 'PILOT' | 'FREE' | 'ALLOWANCE' | 'CREDIT';
export type PromoReason = 'OK' | 'UNKNOWN' | 'INACTIVE' | 'NOT_YET' | 'EXPIRED' | 'USED_UP' | 'RATE_LIMITED';

export interface BillingPlanRow {
  key: string;
  kind: 'ONE_TIME' | 'SUBSCRIPTION';
  interval: 'month' | 'year' | null;
  amount: string;
  currency: string;
  pactsIncluded: number | null;
  overageAmount: string | null;
  grants: PactCreditKind;
  selfServe: boolean;
  stripePriceId: string | null;
  display: { name: string; summary: string };
}

export interface BillingStateRow {
  stripeCustomerId: string | null;
  planKey: string | null;
  status: BillingStatus;
  periodStart: Date | null;
  periodEnd: Date | null;
  pactsUsed: number;
  pactsIncluded: number | null;
  pilot: boolean;
  credits: { kind: PactCreditKind; source: 'PURCHASE' | 'COMP' | 'PROMO'; packs: string[] }[];
  pendingPromo: string | null;
}

export interface PromoCheck {
  reason: PromoReason;
  id: string | null;
  kind: 'DISCOUNT' | 'FREE_PACTS' | null;
  skipsApproval: boolean;
  freePacts: number | null;
  packs: string[];
  percentOff: string | null;
  amountOff: string | null;
  currency: string | null;
}

export interface PromoCodeInput {
  code: string;
  description: string;
  kind: 'DISCOUNT' | 'FREE_PACTS';
  percentOff: string | null;
  amountOff: string | null;
  currency: string | null;
  duration: 'ONCE' | 'REPEATING' | 'FOREVER' | null;
  durationMonths: number | null;
  planKeys: string[];
  freePacts: number | null;
  packs: string[];
  validFrom: Date | null;
  validUntil: Date | null;
  maxRedemptions: number | null;
  skipsApproval: boolean;
}

export interface PromoCodeRow extends Omit<PromoCodeInput, 'validFrom'> {
  id: string;
  validFrom: Date;
  active: boolean;
  redemptions: number;
  stripePromotionCodeId: string | null;
  createdAt: Date;
}

/** Operator-only functions raise 42501 for anyone else. */
async function asOperator<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string }; message?: string };
    if (failure.code === '42501' || failure.meta?.code === '42501' || /\b42501\b|operator required/i.test(String(failure.message))) throw new OperatorRequiredError();
    throw error;
  }
}

const decimal = (value: unknown) => (value === null || value === undefined ? null : String(value));
const date = (value: unknown) => (value ? new Date(value as string) : null);

export const billing = {
  async plans(prisma: PrismaClient): Promise<BillingPlanRow[]> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<Record<string, unknown>[]>`SELECT key, kind, "interval", amount::text, currency, pacts_included, overage_amount::text, grants, self_serve, stripe_price_id, display FROM app_billing_plans()`,
    );
    return rows.map((row) => ({
      key: row['key'] as string,
      kind: row['kind'] as BillingPlanRow['kind'],
      interval: (row['interval'] as BillingPlanRow['interval']) ?? null,
      amount: row['amount'] as string,
      currency: row['currency'] as string,
      pactsIncluded: (row['pacts_included'] as number | null) ?? null,
      overageAmount: decimal(row['overage_amount']),
      grants: row['grants'] as PactCreditKind,
      selfServe: row['self_serve'] as boolean,
      stripePriceId: (row['stripe_price_id'] as string | null) ?? null,
      display: row['display'] as BillingPlanRow['display'],
    }));
  },

  /** Null when the user is not an active member of the organization. */
  async state(prisma: PrismaClient, organizationId: string, userId: string): Promise<BillingStateRow | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<Record<string, unknown>[]>`
        SELECT stripe_customer_id, plan_key, status, period_start, period_end, pacts_used, pacts_included, pilot, credits, pending_promo
          FROM app_billing_state(${organizationId}::uuid, ${userId}::uuid)`,
    );
    if (!row) return null;
    return {
      stripeCustomerId: (row['stripe_customer_id'] as string | null) ?? null,
      planKey: (row['plan_key'] as string | null) ?? null,
      status: row['status'] as BillingStatus,
      periodStart: date(row['period_start']),
      periodEnd: date(row['period_end']),
      pactsUsed: Number(row['pacts_used'] ?? 0),
      pactsIncluded: (row['pacts_included'] as number | null) ?? null,
      pilot: row['pilot'] === true,
      credits: (row['credits'] as BillingStateRow['credits']) ?? [],
      pendingPromo: (row['pending_promo'] as string | null) ?? null,
    };
  },

  /** False when this Stripe event was already handled (a replay). */
  async beginEvent(prisma: PrismaClient, eventId: string, type: string): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ fresh: boolean }[]>`SELECT app_billing_event_begin(${eventId}, ${type}) AS fresh`);
    return row?.fresh === true;
  },

  async linkCustomer(prisma: PrismaClient, organizationId: string, customerId: string): Promise<void> {
    await asApp(prisma, (tx) => tx.$executeRaw`SELECT app_billing_link_customer(${organizationId}::uuid, ${customerId})`);
  },

  async organizationOfCustomer(prisma: PrismaClient, customerId: string): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app_billing_organization_of_customer(${customerId})::text AS id`);
    return row?.id ?? null;
  },

  async grantPurchase(prisma: PrismaClient, organizationId: string, planKey: string, eventId: string): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_billing_grant_purchase(${organizationId}::uuid, ${planKey}, ${eventId}) AS ok`);
    return row?.ok === true;
  },

  async setSubscription(
    prisma: PrismaClient,
    input: { organizationId: string | null; customerId: string | null; subscriptionId: string; planKey: string | null; status: Exclude<BillingStatus, 'NONE'>; periodStart: Date | null; periodEnd: Date | null; newPeriod: boolean },
  ): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ ok: boolean }[]>`
        SELECT app_billing_set_subscription(${input.organizationId}::uuid, ${input.customerId}, ${input.subscriptionId}, ${input.planKey}, ${input.status},
                                            ${input.periodStart}::timestamptz, ${input.periodEnd}::timestamptz, ${input.newPeriod}) AS ok`,
    );
    return row?.ok === true;
  },

  /**
   * What pays for a new pact, in the pact's own transaction (so the two commit together).
   * Null when payment is required (enforcement on, nothing left).
   */
  async consume(tx: TransactionClient, input: { organizationId: string; dealId: string; kind: PactCreditKind; companyType: string; enforce: boolean }): Promise<PactPayment | null> {
    const [row] = await tx.$queryRaw<{ paid_by: PactPayment | null }[]>`
      SELECT app_billing_consume(${input.organizationId}::uuid, ${input.dealId}::uuid, ${input.kind}, ${input.companyType}, ${input.enforce}) AS paid_by`;
    return row?.paid_by ?? null;
  },

  /** The Stripe promotion code to apply at checkout, if the organization redeemed a discount for this plan. */
  async checkoutDiscount(prisma: PrismaClient, organizationId: string, planKey: string): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ code: string | null }[]>`SELECT app_billing_checkout_discount(${organizationId}::uuid, ${planKey}) AS code`);
    return row?.code ?? null;
  },

  // --- Operators ---------------------------------------------------------------------------------

  async adminAccounts(prisma: PrismaClient, actor: string) {
    const rows = await asOperator(() => asApp(prisma, (tx) =>
      tx.$queryRaw<{ organization_id: string; plan_key: string | null; status: BillingStatus; period_end: Date | null; pacts_used: number; open_credits: number; stripe_customer_id: string | null; subscription_id: string | null }[]>`
        SELECT organization_id::text, plan_key, status, period_end, pacts_used, open_credits, stripe_customer_id, subscription_id FROM app_billing_admin_accounts(${actor}::uuid)`,
    ));
    return rows.map((row) => ({
      organizationId: row.organization_id,
      planKey: row.plan_key,
      status: row.status,
      periodEnd: date(row.period_end),
      pactsUsed: Number(row.pacts_used),
      openCredits: Number(row.open_credits),
      stripeCustomerId: row.stripe_customer_id,
      subscriptionId: row.subscription_id,
    }));
  },

  async comp(prisma: PrismaClient, actor: string, organizationId: string, kind: PactCreditKind, packs: string[]): Promise<string> {
    const [row] = await asOperator(() => asApp(prisma, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_billing_comp(${actor}::uuid, ${organizationId}::uuid, ${kind}, ${packs}::text[])::text AS id`));
    if (!row) throw new Error('No id returned');
    return row.id;
  },
};

export const promoCodes = {
  async create(prisma: PrismaClient, actor: string, input: PromoCodeInput): Promise<string> {
    const [row] = await asOperator(() => asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string }[]>`
        SELECT app_promo_create(${actor}::uuid, ${input.code}, ${input.description}, ${input.kind}, ${input.percentOff}::numeric, ${input.amountOff}::numeric, ${input.currency},
                                ${input.duration}, ${input.durationMonths}::integer, ${input.planKeys}::text[], ${input.freePacts}::integer, ${input.packs}::text[],
                                ${input.validFrom}::timestamptz, ${input.validUntil}::timestamptz, ${input.maxRedemptions}::integer, ${input.skipsApproval})::text AS id`,
    ));
    if (!row) throw new Error('No id returned');
    return row.id;
  },

  async setStripe(prisma: PrismaClient, actor: string, id: string, promotionCodeId: string): Promise<void> {
    await asOperator(() => asApp(prisma, (tx) => tx.$executeRaw`SELECT app_promo_set_stripe(${actor}::uuid, ${id}::uuid, ${promotionCodeId})`));
  },

  async deactivate(prisma: PrismaClient, actor: string, id: string): Promise<boolean> {
    const [row] = await asOperator(() => asApp(prisma, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_promo_deactivate(${actor}::uuid, ${id}::uuid) AS ok`));
    return row?.ok === true;
  },

  async list(prisma: PrismaClient, actor: string): Promise<PromoCodeRow[]> {
    const rows = await asOperator(() => asApp(prisma, (tx) =>
      tx.$queryRaw<Record<string, unknown>[]>`
        SELECT id::text, code, description, kind, percent_off::text, amount_off::text, currency, duration, duration_months, plan_keys, free_pacts, packs,
               valid_from, valid_until, max_redemptions, skips_approval, active, redemptions, stripe_promotion_code_id, created_at FROM app_promo_list(${actor}::uuid)`,
    ));
    return rows.map((row) => ({
      id: row['id'] as string,
      code: row['code'] as string,
      description: row['description'] as string,
      kind: row['kind'] as PromoCodeInput['kind'],
      percentOff: decimal(row['percent_off']),
      amountOff: decimal(row['amount_off']),
      currency: (row['currency'] as string | null) ?? null,
      duration: (row['duration'] as PromoCodeInput['duration']) ?? null,
      durationMonths: (row['duration_months'] as number | null) ?? null,
      planKeys: (row['plan_keys'] as string[]) ?? [],
      freePacts: (row['free_pacts'] as number | null) ?? null,
      packs: (row['packs'] as string[]) ?? [],
      validFrom: new Date(row['valid_from'] as string),
      validUntil: date(row['valid_until']),
      maxRedemptions: (row['max_redemptions'] as number | null) ?? null,
      skipsApproval: row['skips_approval'] === true,
      active: row['active'] === true,
      redemptions: Number(row['redemptions'] ?? 0),
      stripePromotionCodeId: (row['stripe_promotion_code_id'] as string | null) ?? null,
      createdAt: new Date(row['created_at'] as string),
    }));
  },

  async check(prisma: PrismaClient, code: string, ipHash: string): Promise<PromoCheck> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<Record<string, unknown>[]>`SELECT reason, id::text, kind, skips_approval, free_pacts, packs, percent_off::text, amount_off::text, currency FROM app_promo_check(${code}, ${ipHash})`,
    );
    return {
      reason: (row?.['reason'] as PromoReason) ?? 'UNKNOWN',
      id: (row?.['id'] as string | null) ?? null,
      kind: (row?.['kind'] as PromoCheck['kind']) ?? null,
      skipsApproval: row?.['skips_approval'] === true,
      freePacts: (row?.['free_pacts'] as number | null) ?? null,
      packs: (row?.['packs'] as string[] | null) ?? [],
      percentOff: decimal(row?.['percent_off']),
      amountOff: decimal(row?.['amount_off']),
      currency: (row?.['currency'] as string | null) ?? null,
    };
  },

  /** REDEEMED, or why not (ALREADY, UNKNOWN, INACTIVE, NOT_YET, EXPIRED, USED_UP). */
  async redeem(prisma: PrismaClient, code: string, organizationId: string, actor: string | null): Promise<string> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ result: string }[]>`SELECT app_promo_redeem(${code}, ${organizationId}::uuid, ${actor}::uuid) AS result`);
    return row?.result ?? 'UNKNOWN';
  },
};
