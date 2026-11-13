'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

/** Letters of intent (T-119). The API checks side, role and signatory on every step. */
const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/loi?outcome=${outcome}`);
const outcomeOf = (result: { kind: string; code?: string }, ok: string) => (result.kind === 'ok' ? ok : result.code ? `error-${result.code}` : result.kind);
const ids = (...values: string[]) => {
  if (!values.every((value) => uuid.safeParse(value).success)) redirect('/deals');
};

export async function draftLoi(dealId: string): Promise<void> {
  ids(dealId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/loi`, {}), 'ok-drafted'));
}

const int = (value: FormDataEntryValue | null, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export async function saveLoiFields(dealId: string, loiId: string, formData: FormData): Promise<void> {
  ids(dealId, loiId);
  const body = {
    exclusivityDays: int(formData.get('exclusivityDays'), 45),
    governingLaw: String(formData.get('governingLaw') ?? '').trim(),
    expenses: String(formData.get('expenses') ?? '').trim(),
    diligenceDays: int(formData.get('diligenceDays'), 30),
    targetSigningDate: String(formData.get('targetSigningDate') ?? '').trim() || null,
    responseDays: int(formData.get('responseDays'), 10),
    conditions: String(formData.get('conditions') ?? '').split('\n').map((line) => line.trim()).filter((line) => line.length > 0),
  };
  back(dealId, outcomeOf(await apiSend('PUT', `/v1/deals/${dealId}/loi/${loiId}/fields`, body), 'ok-saved'));
}

export async function sendLoi(dealId: string, loiId: string, method: 'IN_APP' | 'ESIGN'): Promise<void> {
  ids(dealId, loiId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/loi/${loiId}/send`, { method }), 'ok-sent'));
}

export async function signLoi(dealId: string, loiId: string): Promise<void> {
  ids(dealId, loiId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/loi/${loiId}/sign`, {}), 'ok-signed'));
}

export async function fixtureSignLoi(dealId: string, loiId: string): Promise<void> {
  ids(dealId, loiId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/loi/${loiId}/fixture-sign`, {}), 'ok-signed'));
}

export async function declineLoi(dealId: string, loiId: string): Promise<void> {
  ids(dealId, loiId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/loi/${loiId}/decline`, {}), 'ok-declined'));
}

export async function setLoiRequired(dealId: string, required: boolean): Promise<void> {
  ids(dealId);
  back(dealId, outcomeOf(await apiSend('PUT', `/v1/deals/${dealId}/loi/requirement`, { required }), 'ok-requirement'));
}
