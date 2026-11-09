/**
 * Billing (T-087, ADR 0025). Stripe is the source of truth for money; Pactlab mirrors what it
 * reports. Card data never reaches Pactlab (hosted Checkout and Customer Portal). The fixture
 * adapter runs dev, demos and every test, and signs its events with Stripe's own scheme.
 */
export type BillingProviderName = 'STRIPE' | 'FIXTURE';
export type MirroredStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface CheckoutRequest {
  readonly organizationId: string;
  readonly planKey: string;
  readonly priceId: string;
  readonly mode: 'payment' | 'subscription';
  /** The organization's Stripe customer, once it has one; otherwise Checkout creates it. */
  readonly customerId: string | null;
  readonly email: string | null;
  /** A Stripe promotion code id from a redeemed Pactlab promo code. */
  readonly promotionCodeId: string | null;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly automaticTax: boolean;
}

export interface DiscountRequest {
  readonly code: string;
  readonly name: string;
  /** Exactly one of these; amounts are decimal strings in the currency's major unit. */
  readonly percentOff: string | null;
  readonly amountOff: string | null;
  readonly currency: string | null;
  readonly duration: 'ONCE' | 'REPEATING' | 'FOREVER';
  readonly durationMonths: number | null;
  readonly maxRedemptions: number | null;
  readonly expiresAt: Date | null;
}

export interface SubscriptionSnapshot {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly status: MirroredStatus;
  readonly priceId: string | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly organizationId: string | null;
}

/** A verified Stripe event, reduced to what Pactlab records. */
export type BillingEvent =
  | { readonly id: string; readonly type: 'checkout.completed'; readonly mode: 'payment' | 'subscription'; readonly paid: boolean; readonly organizationId: string | null; readonly planKey: string | null; readonly customerId: string | null; readonly subscriptionId: string | null }
  | { readonly id: string; readonly type: 'invoice.paid' | 'invoice.failed'; readonly customerId: string | null; readonly subscriptionId: string | null }
  | { readonly id: string; readonly type: 'subscription.changed'; readonly subscription: SubscriptionSnapshot }
  | { readonly id: string; readonly type: 'ignored'; readonly stripeType: string };

export class BillingSignatureError extends Error {
  constructor() {
    super('Billing event signature did not verify');
    this.name = 'BillingSignatureError';
  }
}

export interface BillingProvider {
  readonly name: BillingProviderName;
  createCheckout(request: CheckoutRequest): Promise<{ url: string; customerId: string | null }>;
  createPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Mirrors a Pactlab DISCOUNT promo code as a Stripe coupon and promotion code. */
  createDiscount(request: DiscountRequest): Promise<{ promotionCodeId: string }>;
  /** Throws BillingSignatureError when the signature or timestamp does not verify. */
  verifyEvent(rawBody: string, signature: string): BillingEvent;
  subscription(subscriptionId: string): Promise<SubscriptionSnapshot | null>;
}

/** Production without Stripe keys: billing is unavailable, never faked. */
export class UnconfiguredBillingProvider implements BillingProvider {
  readonly name = 'STRIPE' as const;
  createCheckout(): Promise<{ url: string; customerId: string | null }> {
    return Promise.reject(new Error('Billing is not configured in this environment'));
  }
  createPortal(): Promise<{ url: string }> {
    return Promise.reject(new Error('Billing is not configured in this environment'));
  }
  createDiscount(): Promise<{ promotionCodeId: string }> {
    return Promise.reject(new Error('Billing is not configured in this environment'));
  }
  verifyEvent(): BillingEvent {
    throw new BillingSignatureError();
  }
  subscription(): Promise<SubscriptionSnapshot | null> {
    return Promise.resolve(null);
  }
}
