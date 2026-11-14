'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';
import { pricingAnchor } from '../../../valuation/_lib/pricing';

/** Buyer personas (T-105): every action goes through the API, which re-checks the role. */
const uuid = z.uuid();
const persona = z.enum(['QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER']);
const scenarioCase = z.enum(['DOWNSIDE', 'BASE', 'UPSIDE']);
const pricing = (dealId: string) => `/v1/deals/${dealId}/pricing`;

function back(dealId: string, outcome: string): never {
  redirect(`/deals/${dealId}/valuation?outcome=${outcome}#${pricingAnchor(outcome)}`);
}

function ids(...values: string[]) {
  if (!values.every((value) => uuid.safeParse(value).success)) redirect('/deals');
}

/** Evaluate the pact under a persona: a fresh run of the same findings, nothing earlier changes. */
export async function evaluateAs(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  const parsed = persona.safeParse(formData.get('persona'));
  if (!parsed.success) back(dealId, 'invalid');
  const result = await apiSend('POST', `${pricing(dealId)}/evaluations`, { persona: parsed.data });
  back(dealId, result.kind === 'ok' ? 'ok-evaluated' : result.kind === 'invalid' ? 'pricing-no-scenario' : result.kind);
}

export async function adoptEvaluation(dealId: string, evaluationId: string): Promise<void> {
  ids(dealId, evaluationId);
  const result = await apiSend('POST', `${pricing(dealId)}/evaluations/${evaluationId}/adopt`, {});
  back(dealId, result.kind === 'ok' ? 'ok-adopted' : result.kind);
}

/** The persona this pact prices under; empty follows the organization default. */
export async function setPactPersona(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  const value = formData.get('persona');
  const parsed = value === '' ? { success: true as const, data: null } : persona.safeParse(value);
  if (!parsed.success) back(dealId, 'invalid');
  const result = await apiSend('PUT', `${pricing(dealId)}/persona`, { persona: parsed.data });
  back(dealId, result.kind === 'ok' ? 'ok-persona' : result.kind);
}

export async function draftTerms(dealId: string): Promise<void> {
  ids(dealId);
  const result = await apiSend('POST', `${pricing(dealId)}/terms`, {});
  back(dealId, result.kind === 'ok' ? 'ok-drafted' : result.kind === 'conflict' ? 'adopt-first' : result.kind);
}

export async function saveSellerNotes(dealId: string, batchId: string, formData: FormData): Promise<void> {
  ids(dealId, batchId);
  const notes = [...formData.entries()]
    .filter(([key]) => key.startsWith('note-'))
    .map(([key, value]) => ({ ordinal: Number(key.slice(5)), sellerNote: String(value).slice(0, 1000) }))
    .filter((note) => Number.isInteger(note.ordinal) && note.ordinal >= 0);
  const result = await apiSend('PUT', `${pricing(dealId)}/terms/${batchId}/notes`, { notes });
  back(dealId, result.kind === 'ok' ? 'ok-notes' : result.kind === 'conflict' ? 'terms-frozen' : result.kind);
}

export async function proposeTerms(dealId: string, batchId: string): Promise<void> {
  ids(dealId, batchId);
  const result = await apiSend('POST', `${pricing(dealId)}/terms/${batchId}/propose`, {});
  back(dealId, result.kind === 'ok' ? 'ok-proposed' : result.kind === 'conflict' ? 'terms-frozen' : result.kind);
}

export async function draftBrief(dealId: string, evaluationId: string): Promise<void> {
  ids(dealId, evaluationId);
  const result = await apiSend('POST', `${pricing(dealId)}/evaluations/${evaluationId}/brief`, {});
  back(
    dealId,
    result.kind === 'ok'
      ? 'ok-brief'
      : result.kind === 'unavailable'
        ? result.code === 'AI_OFF'
          ? 'brief-off'
          : 'brief-unavailable'
        : result.kind === 'invalid'
          ? 'brief-no-findings'
          : result.kind,
  );
}

/** Take the seller's counters into the next draft version. */
export async function acceptCounters(dealId: string, batchId: string): Promise<void> {
  ids(dealId, batchId);
  const result = await apiSend('POST', `${pricing(dealId)}/terms/${batchId}/accept-counters`, {});
  back(dealId, result.kind === 'ok' ? 'ok-counters' : result.kind === 'conflict' ? 'terms-frozen' : result.kind);
}

/** Tag a scenario Downside, Base or Upside; empty clears it. */
export async function setScenarioCase(dealId: string, scenarioId: string, formData: FormData): Promise<void> {
  ids(dealId, scenarioId);
  const value = formData.get('scenarioCase');
  const parsed = value === '' ? { success: true as const, data: null } : scenarioCase.safeParse(value);
  if (!parsed.success) back(dealId, 'invalid');
  const result = await apiSend('POST', `/v1/deals/${dealId}/valuation/scenarios/${scenarioId}/case`, { scenarioCase: parsed.data });
  back(dealId, result.kind === 'ok' ? 'ok-case' : result.kind);
}

/** A financing contingency on the buyer's draft (T-117): the financed amount it covers and its date. */
export async function addFinancingContingency(dealId: string, batchId: string, formData: FormData): Promise<void> {
  ids(dealId, batchId);
  const amount = String(formData.get('amount') ?? '').replace(/[,\s]/g, '');
  const dueOn = String(formData.get('dueOn') ?? '');
  if (!/^\d{1,18}(\.\d{1,2})?$/.test(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) back(dealId, 'contingency-invalid');
  const result = await apiSend('POST', `${pricing(dealId)}/terms/${batchId}/financing-contingency`, { amount, dueOn, note: String(formData.get('note') ?? '').slice(0, 1000) });
  back(dealId, result.kind === 'ok' ? 'ok-contingency' : result.kind === 'conflict' ? 'terms-frozen' : result.kind === 'invalid' ? 'contingency-invalid' : result.kind);
}
