'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../deals/_lib/api';

const provider = z.enum(['google-drive', 'onedrive']);
/** Where each provider's sign-in lives: the start URL must go there, nowhere else. */
const SIGN_IN = { 'google-drive': 'https://accounts.google.com/', onedrive: 'https://login.microsoftonline.com/' } as const;

/** Start signing the organization in to Google Drive or OneDrive (T-147): off to the provider's sign-in. */
export async function connectDocumentSource(formData: FormData): Promise<void> {
  const parsed = provider.safeParse(formData.get('provider'));
  if (!parsed.success) redirect('/settings?outcome=document-source-unavailable#document-sources');
  const result = await apiSend<{ url: string }>('POST', `/v1/organization/document-connections/${parsed.data}/start`, {});
  if (result.kind !== 'ok' || !result.data.url.startsWith(SIGN_IN[parsed.data])) redirect('/settings?outcome=document-source-unavailable#document-sources');
  redirect(result.data.url);
}

export async function disconnectDocumentSource(formData: FormData): Promise<void> {
  const parsed = provider.safeParse(formData.get('provider'));
  if (!parsed.success) redirect('/settings#document-sources');
  const result = await apiSend('POST', `/v1/organization/document-connections/${parsed.data}/disconnect`, {});
  redirect(`/settings?outcome=${result.kind === 'ok' ? 'document-source-disconnected' : 'document-source-failed'}#document-sources`);
}
