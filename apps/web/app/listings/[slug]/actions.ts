'use server';

import { listingInterestSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { authApi } from '../../../lib/native-session';

/** Send a request for access. The API answers the same whatever happened; the visitor then checks their email. */
export async function requestAccess(slug: string, form: FormData): Promise<void> {
  if (!/^pl-[a-z0-9]{10}$/.test(slug)) redirect('/');
  const parsed = listingInterestSchema.safeParse({
    name: form.get('name'),
    firm: form.get('firm'),
    email: form.get('email'),
    intent: form.get('intent'),
    message: form.get('message'),
    website: String(form.get('website') ?? ''),
  });
  if (!parsed.success || form.get('consent') !== 'on') redirect(`/listings/${slug}?error=details#request`);
  const sent = await authApi(`/v1/public/listings/${slug}/interest`, parsed.data);
  redirect(sent.status === 202 ? `/listings/${slug}?sent=1#request` : `/listings/${slug}?error=unavailable#request`);
}
