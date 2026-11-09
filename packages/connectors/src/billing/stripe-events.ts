import type Stripe from 'stripe';
import { BillingSignatureError, type BillingEvent, type MirroredStatus, type SubscriptionSnapshot } from './types';

/** Stripe's subscription states, folded into the three Pactlab mirrors. */
export function mirroredStatus(status: string): MirroredStatus {
  if (status === 'active' || status === 'trialing') return 'ACTIVE';
  if (status === 'canceled' || status === 'incomplete_expired') return 'CANCELED';
  return 'PAST_DUE';
}

const idOf = (value: unknown): string | null => (typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String((value as { id: unknown }).id) : null);
const at = (seconds: unknown) => (typeof seconds === 'number' ? new Date(seconds * 1000) : null);

/** A subscription as Stripe returns it (periods live on its items since API 2025-03). */
export function snapshotOf(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const item = subscription.items?.data?.[0];
  return {
    subscriptionId: subscription.id,
    customerId: idOf(subscription.customer) ?? '',
    status: mirroredStatus(subscription.status),
    priceId: item?.price?.id ?? null,
    periodStart: at(item?.current_period_start),
    periodEnd: at(item?.current_period_end),
    organizationId: subscription.metadata?.['organizationId'] ?? null,
  };
}

/** Verify a webhook with Stripe's own signature check (offline), then normalize it. */
export function verifyStripeEvent(stripe: Stripe, rawBody: string, signature: string, secret: string): BillingEvent {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new BillingSignatureError();
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      return {
        id: event.id,
        type: 'checkout.completed',
        mode: session.mode === 'subscription' ? 'subscription' : 'payment',
        paid: session.payment_status === 'paid' || session.payment_status === 'no_payment_required',
        organizationId: session.client_reference_id ?? session.metadata?.['organizationId'] ?? null,
        planKey: session.metadata?.['planKey'] ?? null,
        customerId: idOf(session.customer),
        subscriptionId: idOf(session.subscription),
      };
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      return {
        id: event.id,
        type: event.type === 'invoice.paid' ? 'invoice.paid' : 'invoice.failed',
        customerId: idOf(invoice.customer),
        subscriptionId: idOf(invoice.parent?.subscription_details?.subscription),
      };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return { id: event.id, type: 'subscription.changed', subscription: snapshotOf(event.data.object) };
    default:
      return { id: event.id, type: 'ignored', stripeType: event.type };
  }
}

/** "12.50" → 1250 without floating point (two-decimal currencies, as Pactlab prices). */
export function minorUnits(amount: string): number {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) throw new Error('Amount must be a decimal with at most two places');
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}
