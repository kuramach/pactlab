'use server';

import { redirect } from 'next/navigation';
import { authApi } from '../../../../lib/native-session';

/** Confirm the address on a request for access; it then reaches the seller. */
export async function confirmRequest(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) redirect(`/listings/confirm/${encodeURIComponent(token)}?result=invalid`);
  const confirmed = await authApi('/v1/public/listing-interest/confirm', { token });
  redirect(`/listings/confirm/${token}?result=${confirmed.status === 200 ? 'ok' : 'invalid'}`);
}
