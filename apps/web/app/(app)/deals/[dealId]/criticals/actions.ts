'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { structureFrom } from '../../../_lib/criticals/fields';
import { apiPost } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/criticals?outcome=${encodeURIComponent(outcome)}`);
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const failed = (result: { kind: string; code?: string }) =>
  result.kind === 'invalid' && result.code ? ({ STRUCTURE_INVALID: 'structure-invalid', OVERRIDE_METRIC: 'override-metric', ORG_ADMIN_REQUIRED: 'admin', NOT_CONFIRMED: 'not-confirmed' }[result.code] ?? 'invalid') : result.kind;
const guard = (...ids: string[]) => {
  if (!ids.every((id) => uuid.safeParse(id).success)) redirect('/deals');
};

/** Rate every confirmed critical against the pact's evidence now. Re-evaluation is explicit; it never runs on its own. */
export async function evaluateCriticals(dealId: string): Promise<void> {
  guard(dealId);
  const result = await apiPost<{ rated: number; skipped: unknown[] }>(`/v1/deals/${dealId}/criticals/evaluate`, {});
  back(dealId, result.kind === 'ok' ? (result.data.skipped.length > 0 ? 'ok-evaluated-skipped' : 'ok-evaluated') : failed(result));
}

/** A critical for this pact alone, in words (Pactlab proposes the structure) to confirm before it rates anything. */
export async function addPactCritical(dealId: string, form: FormData): Promise<void> {
  guard(dealId);
  const result = await apiPost(`/v1/deals/${dealId}/criticals`, { words: text(form, 'words') });
  back(dealId, result.kind === 'ok' ? 'ok-proposed' : failed(result));
}

export async function confirmPactCritical(dealId: string, criticalKey: string, version: number, form: FormData): Promise<void> {
  guard(dealId, criticalKey);
  const structure = structureFrom(form);
  if (!structure) back(dealId, 'threshold');
  const result = await apiPost(`/v1/deals/${dealId}/criticals/${criticalKey}/confirm`, { version, structure });
  back(dealId, result.kind === 'ok' ? 'ok-confirmed' : failed(result));
}

/** Tighten, loosen or switch off an org standard for this pact: stamped with who, when and the reason. */
export async function overrideStandard(dealId: string, standardKey: string, form: FormData): Promise<void> {
  guard(dealId, standardKey);
  const disabled = text(form, 'mode') === 'off';
  const structure = disabled ? null : structureFrom(form);
  if (!disabled && !structure) back(dealId, 'threshold');
  const result = await apiPost(`/v1/deals/${dealId}/criticals/overrides`, { standardKey, structure, disabled, reason: text(form, 'reason') });
  back(dealId, result.kind === 'ok' ? 'ok-overridden' : failed(result));
}

export async function clearOverride(dealId: string, overrideKey: string, version: number): Promise<void> {
  guard(dealId, overrideKey);
  const result = await apiPost(`/v1/deals/${dealId}/criticals/${overrideKey}/retire`, { version, reason: 'Back to the org standard' });
  back(dealId, result.kind === 'ok' ? 'ok-cleared' : failed(result));
}

/** "Make this an org critical": the confirmed structure joins the library for pacts of this type. */
export async function promoteCritical(dealId: string, criticalKey: string): Promise<void> {
  guard(dealId, criticalKey);
  const result = await apiPost(`/v1/deals/${dealId}/criticals/${criticalKey}/promote`, {});
  back(dealId, result.kind === 'ok' ? 'ok-promoted' : failed(result));
}
