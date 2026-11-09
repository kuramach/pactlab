import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { verifyStripeEvent } from './stripe-events';
import type { BillingEvent, BillingProvider, CheckoutRequest, DiscountRequest, SubscriptionSnapshot } from './types';

/** A signed webhook delivery, as Stripe would send it. */
export interface FixtureDelivery {
  readonly payload: string;
  readonly signature: string;
}

const id = (prefix: string) => `${prefix}_fixture_${randomBytes(9).toString('hex')}`;
const now = () => Math.floor(Date.now() / 1000);

/**
 * Billing without Stripe (dev, demos, tests). "Checkout" is a local page; completing it
 * produces the same events Stripe sends, in Stripe's JSON shape, signed with Stripe's own
 * scheme — so the webhook path, signature check included, is exactly the live one.
 */
export class FixtureBillingProvider implements BillingProvider {
  readonly name = 'FIXTURE' as const;
  private readonly stripe = new Stripe('sk_test_fixture_offline');
  private readonly sessions = new Map<string, CheckoutRequest & { customerId: string }>();
  private readonly subscriptions = new Map<string, SubscriptionSnapshot>();

  constructor(
    readonly webhookSecret: string,
    private readonly checkoutPageUrl: string,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<{ url: string; customerId: string | null }> {
    const session = id('cs');
    const customerId = request.customerId ?? id('cus');
    this.sessions.set(session, { ...request, customerId });
    const url = new URL(this.checkoutPageUrl);
    url.searchParams.set('session', session);
    return { url: url.toString(), customerId: request.customerId ? null : customerId };
  }

  async createPortal(customerId: string, returnUrl: string): Promise<{ url: string }> {
    return { url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}portal=fixture&customer=${encodeURIComponent(customerId)}` };
  }

  async createDiscount(_request: DiscountRequest): Promise<{ promotionCodeId: string }> {
    return { promotionCodeId: id('promo') };
  }

  verifyEvent(rawBody: string, signature: string): BillingEvent {
    return verifyStripeEvent(this.stripe, rawBody, signature, this.webhookSecret);
  }

  async subscription(subscriptionId: string): Promise<SubscriptionSnapshot | null> {
    return this.subscriptions.get(subscriptionId) ?? null;
  }

  /** The request a fixture checkout session was made for (the local checkout page shows it). */
  session(sessionId: string): (CheckoutRequest & { customerId: string }) | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** Sign any Stripe-shaped event, for tests that need a specific one. */
  sign(type: string, object: Record<string, unknown>): FixtureDelivery {
    const payload = JSON.stringify({ id: id('evt'), object: 'event', type, created: now(), livemode: false, data: { object } });
    return { payload, signature: this.stripe.webhooks.generateTestHeaderString({ payload, secret: this.webhookSecret }) };
  }

  /** "Pay": the deliveries Stripe would send for this checkout, in order. */
  complete(sessionId: string): FixtureDelivery[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Unknown fixture checkout session');
    this.sessions.delete(sessionId);
    const metadata = { organizationId: session.organizationId, planKey: session.planKey };
    if (session.mode === 'payment') {
      return [this.sign('checkout.session.completed', { id: sessionId, object: 'checkout.session', mode: 'payment', payment_status: 'paid', client_reference_id: session.organizationId, metadata, customer: session.customerId, subscription: null })];
    }
    const subscriptionId = id('sub');
    const end = now() + (session.planKey.endsWith('MONTHLY') ? 31 : 366) * 86_400;
    this.subscriptions.set(subscriptionId, { subscriptionId, customerId: session.customerId, status: 'ACTIVE', priceId: session.priceId, periodStart: new Date(now() * 1000), periodEnd: new Date(end * 1000), organizationId: session.organizationId });
    return [
      this.sign('checkout.session.completed', { id: sessionId, object: 'checkout.session', mode: 'subscription', payment_status: 'paid', client_reference_id: session.organizationId, metadata, customer: session.customerId, subscription: subscriptionId }),
      this.subscriptionEvent('customer.subscription.created', subscriptionId),
      this.sign('invoice.paid', { id: id('in'), object: 'invoice', customer: session.customerId, parent: { type: 'subscription_details', subscription_details: { subscription: subscriptionId } } }),
    ];
  }

  /** Change a fixture subscription's Stripe status and get the event Stripe would send. */
  setStatus(subscriptionId: string, status: 'active' | 'past_due' | 'canceled'): FixtureDelivery {
    const current = this.subscriptions.get(subscriptionId);
    if (!current) throw new Error('Unknown fixture subscription');
    this.subscriptions.set(subscriptionId, { ...current, status: status === 'active' ? 'ACTIVE' : status === 'canceled' ? 'CANCELED' : 'PAST_DUE' });
    return this.subscriptionEvent(status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated', subscriptionId, status);
  }

  private subscriptionEvent(type: string, subscriptionId: string, status?: string): FixtureDelivery {
    const snapshot = this.subscriptions.get(subscriptionId);
    if (!snapshot) throw new Error('Unknown fixture subscription');
    const stripeStatus = status ?? (snapshot.status === 'ACTIVE' ? 'active' : snapshot.status === 'CANCELED' ? 'canceled' : 'past_due');
    return this.sign(type, {
      id: subscriptionId,
      object: 'subscription',
      status: stripeStatus,
      customer: snapshot.customerId,
      metadata: { organizationId: snapshot.organizationId ?? '' },
      items: { object: 'list', data: [{ id: id('si'), price: { id: snapshot.priceId }, current_period_start: Math.floor((snapshot.periodStart?.getTime() ?? Date.now()) / 1000), current_period_end: Math.floor((snapshot.periodEnd?.getTime() ?? Date.now()) / 1000) }] },
    });
  }
}
