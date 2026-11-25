'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '../../deals/_lib/api';

/** Dismiss a card for this person; it moves behind the icon by the bug icon. */
export async function dismissFeatureCard(formData: FormData): Promise<void> {
  const cardId = String(formData.get('cardId') ?? '');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(cardId)) return;
  await apiPost(`/v1/feature-cards/${cardId}/dismiss`, {});
  revalidatePath('/', 'layout');
}

/** The icon's list was opened: its cards count as read. */
export async function markFeatureCardsRead(): Promise<void> {
  await apiPost('/v1/feature-cards/read', {});
}
