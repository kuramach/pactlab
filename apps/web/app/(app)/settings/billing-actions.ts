'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiSend } from '../deals/_lib/api';

const back = (outcome: string) => redirect(`/settings?billing=${encodeURIComponent(outcome)}#billing`);

/** To Stripe's hosted Checkout (T-087). Pactlab never sees card details. */
export async function startCheckout(plan: string): Promise<void> {
  const result = await apiSend<{ url: string }>('POST', '/v1/billing/checkout', { plan });
  if (result.kind !== 'ok') back(result.kind === 'unavailable' ? 'not-configured' : 'checkout-failed');
  redirect((result as { data: { url: string } }).data.url);
}

/** To Stripe's hosted Customer Portal: invoices, card, plan, cancellation. */
export async function openPortal(): Promise<void> {
  const result = await apiSend<{ url: string }>('POST', '/v1/billing/portal', {});
  if (result.kind !== 'ok') back('portal-failed');
  redirect((result as { data: { url: string } }).data.url);
}

export async function redeemPromo(formData: FormData): Promise<void> {
  const code = String(formData.get('code') ?? '').trim();
  const result = await apiSend('POST', '/v1/billing/promo', { code });
  revalidatePath('/settings');
  if (result.kind === 'ok') back('promo-ok');
  back(result.kind === 'invalid' && result.code ? result.code.toLowerCase() : 'promo_unknown');
}
