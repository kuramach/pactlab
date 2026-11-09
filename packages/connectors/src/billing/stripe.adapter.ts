import Stripe from 'stripe';
import { minorUnits, snapshotOf, verifyStripeEvent } from './stripe-events';
import type { BillingEvent, BillingProvider, CheckoutRequest, DiscountRequest, SubscriptionSnapshot } from './types';

/**
 * Stripe (test or live, by the key). Hosted Checkout and Customer Portal only. VAT numbers are
 * collected for business customers; Stripe Tax is on only when the CPA-decided flag says so.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'STRIPE' as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckout(request: CheckoutRequest): Promise<{ url: string; customerId: string | null }> {
    const metadata = { organizationId: request.organizationId, planKey: request.planKey };
    const session = await this.stripe.checkout.sessions.create({
      mode: request.mode,
      line_items: [{ price: request.priceId, quantity: 1 }],
      client_reference_id: request.organizationId,
      metadata,
      ...(request.customerId ? { customer: request.customerId } : request.email ? { customer_email: request.email } : {}),
      ...(request.mode === 'payment' && !request.customerId ? { customer_creation: 'always' as const } : {}),
      ...(request.mode === 'payment' ? { invoice_creation: { enabled: true } } : { subscription_data: { metadata } }),
      ...(request.promotionCodeId ? { discounts: [{ promotion_code: request.promotionCodeId }] } : {}),
      tax_id_collection: { enabled: true },
      automatic_tax: { enabled: request.automaticTax },
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe returned no checkout URL');
    return { url: session.url, customerId: typeof session.customer === 'string' ? session.customer : null };
  }

  async createPortal(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: session.url };
  }

  async createDiscount(request: DiscountRequest): Promise<{ promotionCodeId: string }> {
    const coupon = await this.stripe.coupons.create({
      name: request.name.slice(0, 40),
      duration: request.duration === 'ONCE' ? 'once' : request.duration === 'FOREVER' ? 'forever' : 'repeating',
      ...(request.duration === 'REPEATING' && request.durationMonths ? { duration_in_months: request.durationMonths } : {}),
      ...(request.percentOff ? { percent_off: Number(request.percentOff) } : {}),
      ...(request.amountOff && request.currency ? { amount_off: minorUnits(request.amountOff), currency: request.currency.toLowerCase() } : {}),
    });
    const promotion = await this.stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: request.code,
      ...(request.maxRedemptions ? { max_redemptions: request.maxRedemptions } : {}),
      ...(request.expiresAt ? { expires_at: Math.floor(request.expiresAt.getTime() / 1000) } : {}),
    });
    return { promotionCodeId: promotion.id };
  }

  verifyEvent(rawBody: string, signature: string): BillingEvent {
    return verifyStripeEvent(this.stripe, rawBody, signature, this.webhookSecret);
  }

  async subscription(subscriptionId: string): Promise<SubscriptionSnapshot | null> {
    try {
      return snapshotOf(await this.stripe.subscriptions.retrieve(subscriptionId));
    } catch (error) {
      if ((error as { code?: string }).code === 'resource_missing') return null;
      throw error;
    }
  }
}
