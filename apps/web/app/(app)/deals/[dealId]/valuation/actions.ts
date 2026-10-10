'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { scenarioFromForm, type ScenarioValues } from '../../../valuation/_lib/form';
import { apiGet, apiSend } from '../../_lib/api';

const uuid = z.uuid();
const version = z.coerce.number().int().positive();
const base = (dealId: string) => `/v1/deals/${dealId}/valuation/scenarios`;

function back(dealId: string, outcome: string): never {
  redirect(`/deals/${dealId}/valuation?outcome=${outcome}`);
}

export interface ScenarioFormState {
  error: string | null;
}

const FAILURES: Record<string, string> = {
  invalid: 'The engine rejected these inputs. Check rates, multiples and LBO values (take-privates need LBO inputs).',
  conflict: 'This scenario changed or was submitted in the meantime. Reload and try again.',
  forbidden: 'Your role cannot edit valuation scenarios.',
  'signed-out': 'Your session ended. Log in again.',
};

/** Create a scenario, or save a new version of a draft's assumptions. */
export async function saveScenario(
  dealId: string,
  scenarioId: string | null,
  expectedVersion: number | null,
  _previous: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  if (!uuid.safeParse(dealId).success || (scenarioId !== null && !uuid.safeParse(scenarioId).success)) return { error: 'Unknown deal.' };
  let previous: Partial<ScenarioValues> | null = null;
  if (scenarioId) {
    const current = await apiGet<{ assumptions: ScenarioValues }>(`${base(dealId)}/${scenarioId}`);
    if (current.kind !== 'ok') return { error: 'The scenario could not be loaded.' };
    previous = current.data.assumptions;
  }
  const parsed = scenarioFromForm(formData, previous);
  if (!parsed.ok) return { error: parsed.message };
  const result = scenarioId
    ? await apiSend('PUT', `${base(dealId)}/${scenarioId}/assumptions`, { expectedVersion, values: parsed.values })
    : await apiSend('POST', base(dealId), { name: parsed.name, values: parsed.values });
  if (result.kind !== 'ok') return { error: FAILURES[result.kind] ?? 'The scenario could not be saved. Try again.' };
  back(dealId, scenarioId ? 'ok-saved' : 'ok-created');
}

/** Run the engine on the current assumptions. */
export async function runScenario(dealId: string, scenarioId: string, expectedVersion: number): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(scenarioId).success) redirect('/deals');
  const result = await apiSend('POST', `${base(dealId)}/${scenarioId}/runs`, { expectedVersion });
  back(dealId, result.kind === 'ok' ? 'ok-run' : result.kind);
}

/** Freeze the current run for approval by a second person. */
export async function submitScenario(dealId: string, scenarioId: string, expectedVersion: number): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(scenarioId).success) redirect('/deals');
  const result = await apiSend('POST', `${base(dealId)}/${scenarioId}/submissions`, { expectedVersion }, { 'idempotency-key': `web-${randomUUID()}` });
  back(dealId, result.kind === 'ok' ? 'ok-submitted' : result.kind);
}

const decision = z.strictObject({
  decision: z.enum(['APPROVED', 'REJECTED']),
  rationale: z.string().trim().min(1).max(4000),
  expectedVersion: version,
});

/** Approve or reject a frozen submission. The API refuses the submitter's own decision. */
export async function decideSubmission(dealId: string, scenarioId: string, submissionId: string, formData: FormData): Promise<void> {
  if (![dealId, scenarioId, submissionId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const parsed = decision.safeParse({
    decision: formData.get('decision'),
    rationale: formData.get('rationale'),
    expectedVersion: formData.get('expectedVersion'),
  });
  if (!parsed.success) back(dealId, 'rationale');
  const result = await apiSend('POST', `${base(dealId)}/${scenarioId}/submissions/${submissionId}/decisions`, parsed.data);
  back(dealId, result.kind === 'ok' ? `ok-${parsed.data.decision.toLowerCase()}` : result.kind === 'forbidden' ? 'own-submission' : result.kind);
}
