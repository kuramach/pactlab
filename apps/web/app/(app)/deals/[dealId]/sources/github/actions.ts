'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { dealsApi, type ValidationView } from '../../../_lib/api';

export type ConnectState =
  | { kind: 'idle' }
  | { kind: 'connected'; connectionId: string; name: string; validation: ValidationView }
  | { kind: 'error'; message: string };

// Mirrors the API: owner (letters, digits, hyphens) / name (never `.` or `..`).
const repository = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/)
  .refine((value) => !['.', '..'].includes(value.split('/')[1] ?? ''));

const input = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('APP'), repository }),
  z.strictObject({ method: z.literal('TOKEN'), repository, token: z.string().trim().regex(/^[A-Za-z0-9_]{20,255}$/) }),
]);

const FAILURES: Record<string, string> = {
  conflict: 'The Pactlab GitHub App is not set up on this server yet. Use a token instead.',
  unavailable: 'Tokens cannot be stored on this server yet. Ask your administrator to configure the secret store.',
  forbidden: 'Your role cannot connect sources to this deal.',
  invalid: 'Check the repository name and token.',
  'signed-out': 'Your session ended. Log in again.',
};

/** Connect a repository live and return the four connection checks. The token is passed on once and never kept here. */
export async function connectGitHub(dealId: string, _previous: ConnectState, formData: FormData): Promise<ConnectState> {
  if (!z.uuid().safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  const method = formData.get('method') === 'TOKEN' ? 'TOKEN' : 'APP';
  const parsed = input.safeParse(
    method === 'TOKEN'
      ? { method, repository: formData.get('repository'), token: formData.get('token') }
      : { method, repository: formData.get('repository') },
  );
  if (!parsed.success)
    return { kind: 'error', message: 'Enter the repository as owner/name' + (method === 'TOKEN' ? ' and paste a valid token.' : '.') };
  const result = await dealsApi.connectGitHub(dealId, parsed.data);
  if (result.kind !== 'ok') return { kind: 'error', message: FAILURES[result.kind] ?? 'GitHub could not be connected. Try again.' };
  return {
    kind: 'connected',
    connectionId: result.data.connection.id,
    name: result.data.connection.displayName,
    validation: result.data.validation,
  };
}

/** Pull the repository head now, then show it on Sources. */
export async function syncNow(dealId: string, connectionId: string): Promise<void> {
  if (!z.uuid().safeParse(dealId).success || !z.uuid().safeParse(connectionId).success) redirect('/deals');
  await dealsApi.requestSync(dealId, connectionId, `web-${randomUUID()}`);
  redirect(`/deals/${dealId}/sources`);
}
