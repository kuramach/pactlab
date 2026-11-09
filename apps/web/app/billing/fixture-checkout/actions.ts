'use server';

import { redirect } from 'next/navigation';
import { apiSend } from '../../(app)/deals/_lib/api';

/** "Pay" a fixture checkout (local and test environments only): the API sends itself the signed events Stripe would. */
export async function payFixture(session: string): Promise<void> {
  const result = await apiSend('POST', '/v1/billing/fixture/complete', { session });
  redirect(`/settings?billing=${result.kind === 'ok' ? 'returned' : 'checkout-failed'}#billing`);
}
