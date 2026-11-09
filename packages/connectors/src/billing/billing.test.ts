import { describe, expect, it } from 'vitest';
import { BillingSignatureError, FixtureBillingProvider, minorUnits, mirroredStatus } from './index';

describe('billing adapter (T-087)', () => {
  const provider = new FixtureBillingProvider('whsec_test_fixture', 'http://localhost:3000/billing/fixture-checkout');

  it('a fixture one-time checkout yields one signed, verifiable checkout.completed', async () => {
    const { url } = await provider.createCheckout({ organizationId: 'org-1', planKey: 'PACT', priceId: 'price_pact', mode: 'payment', customerId: null, email: 'a@example.test', promotionCodeId: null, successUrl: 'http://x/ok', cancelUrl: 'http://x/no', automaticTax: false });
    const session = new URL(url).searchParams.get('session')!;
    const [delivery] = provider.complete(session);
    expect(provider.verifyEvent(delivery!.payload, delivery!.signature)).toMatchObject({ type: 'checkout.completed', mode: 'payment', paid: true, organizationId: 'org-1', planKey: 'PACT' });
    expect(() => provider.complete(session)).toThrow();
  });

  it('a subscription checkout also yields the subscription and its first paid invoice', async () => {
    const { url } = await provider.createCheckout({ organizationId: 'org-2', planKey: 'TEAM_ANNUAL', priceId: 'price_team', mode: 'subscription', customerId: 'cus_x', email: null, promotionCodeId: null, successUrl: 'http://x/ok', cancelUrl: 'http://x/no', automaticTax: false });
    const events = provider.complete(new URL(url).searchParams.get('session')!).map((delivery) => provider.verifyEvent(delivery.payload, delivery.signature));
    expect(events.map((event) => event.type)).toEqual(['checkout.completed', 'subscription.changed', 'invoice.paid']);
    const changed = events[1] as Extract<(typeof events)[number], { type: 'subscription.changed' }>;
    expect(changed.subscription).toMatchObject({ status: 'ACTIVE', priceId: 'price_team', organizationId: 'org-2' });
    expect(changed.subscription.periodEnd!.getTime()).toBeGreaterThan(Date.now());
  });

  it('a tampered or wrongly signed event is refused', () => {
    const delivery = provider.sign('checkout.session.completed', { id: 'cs_1', mode: 'payment', payment_status: 'paid' });
    expect(() => provider.verifyEvent(delivery.payload.replace('paid', 'unpaid'), delivery.signature)).toThrow(BillingSignatureError);
    const other = new FixtureBillingProvider('whsec_other', 'http://x');
    expect(() => other.verifyEvent(delivery.payload, delivery.signature)).toThrow(BillingSignatureError);
  });

  it('amounts to minor units without floats; Stripe statuses fold to three', () => {
    expect(minorUnits('2500')).toBe(250000);
    expect(minorUnits('12.5')).toBe(1250);
    expect(minorUnits('0.07')).toBe(7);
    expect(() => minorUnits('1.234')).toThrow();
    expect(['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete_expired'].map(mirroredStatus)).toEqual(['ACTIVE', 'ACTIVE', 'PAST_DUE', 'PAST_DUE', 'CANCELED', 'CANCELED']);
  });
});
