'use server';

import { redirect } from 'next/navigation';
import { dealsApi } from '../../deals/_lib/api';
import { pactFromForm } from '../_lib/form';

export interface StartPactState {
  error: string | null;
}

const FAILURES: Readonly<Record<string, string>> = {
  invalid: 'Some details were not accepted. Check them and try again.',
  'signed-out': 'Your session ended. Log in again to start a Pact.',
  forbidden: 'Your role does not allow starting a Pact.',
};

/** Start a Pact; on success open its Sources checklist. The API re-validates everything. */
export async function startPact(_previous: StartPactState, formData: FormData): Promise<StartPactState> {
  const parsed = pactFromForm(formData);
  if (!parsed.ok) return { error: parsed.message };
  const result = await dealsApi.startPact(parsed.command);
  if (result.kind !== 'ok') return { error: FAILURES[result.kind] ?? 'The Pact could not be started. Try again shortly.' };
  redirect(`/deals/${result.data.id}/sources?started=1`);
}
