'use server';

import { ACCREDITATION_STATUSES } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/spv?outcome=${encodeURIComponent(outcome)}`);
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const orNull = (value: string) => (value === '' ? null : value);
const failure = (result: { kind: string; code?: string }) => (result.kind === 'invalid' ? (result.code === 'VEHICLE_REQUIRED' ? 'vehicle' : 'invalid') : result.kind);
const guard = (dealId: string, ...ids: string[]) => {
  if (!uuid.safeParse(dealId).success || ids.some((id) => !uuid.safeParse(id).success)) redirect('/deals');
};

/** The vehicle's name and the exit paths the return scenarios run on (the organizer's stated assumptions). */
export async function saveVehicle(dealId: string, form: FormData): Promise<void> {
  guard(dealId);
  const result = await apiSend('PUT', `/v1/deals/${dealId}/spv/vehicle`, {
    vehicleName: text(form, 'vehicleName'),
    downsideMultiple: orNull(text(form, 'downsideMultiple')),
    baseMultiple: orNull(text(form, 'baseMultiple')),
    upsideMultiple: orNull(text(form, 'upsideMultiple')),
  });
  back(dealId, result.kind === 'ok' ? 'ok-vehicle' : failure(result));
}

export async function addSeat(dealId: string, form: FormData): Promise<void> {
  guard(dealId);
  const status = text(form, 'accreditationStatus');
  const result = await apiPost(`/v1/deals/${dealId}/spv/seats`, {
    label: text(form, 'label'),
    reference: text(form, 'reference'),
    commitment: orNull(text(form, 'commitment')),
    accreditationStatus: (ACCREDITATION_STATUSES as readonly string[]).includes(status) ? status : 'NOT_STARTED',
  });
  back(dealId, result.kind === 'ok' ? 'ok-seat' : result.kind === 'conflict' ? 'reference' : failure(result));
}

/** The tracked accreditation status, with the specialist's link and an evidence pointer. Pactlab verifies nothing. */
export async function updateAccreditation(dealId: string, seatId: string, form: FormData): Promise<void> {
  guard(dealId, seatId);
  const status = text(form, 'accreditationStatus');
  const result = await apiSend('PATCH', `/v1/deals/${dealId}/spv/seats/${seatId}`, {
    ...((ACCREDITATION_STATUSES as readonly string[]).includes(status) ? { accreditationStatus: status } : {}),
    accreditationProvider: orNull(text(form, 'accreditationProvider')),
    accreditationUrl: orNull(text(form, 'accreditationUrl')),
    accreditationEvidence: orNull(text(form, 'accreditationEvidence')),
  });
  back(dealId, result.kind === 'ok' ? 'ok-accreditation' : failure(result));
}

export async function withdrawSeat(dealId: string, seatId: string): Promise<void> {
  guard(dealId, seatId);
  const result = await apiSend('PATCH', `/v1/deals/${dealId}/spv/seats/${seatId}`, { status: 'WITHDRAWN' });
  back(dealId, result.kind === 'ok' ? 'ok-withdrawn' : failure(result));
}

/** Invite one person to one seat: they join this pact only, as that investor. */
export async function inviteInvestor(dealId: string, seatId: string, form: FormData): Promise<void> {
  guard(dealId, seatId);
  const result = await apiPost<{ kind: string; emailed?: boolean }>(`/v1/deals/${dealId}/spv/seats/${seatId}/invite`, { email: text(form, 'email') });
  back(dealId, result.kind === 'ok' ? (result.data.emailed === false ? 'ok-invited-unsent' : 'ok-invited') : result.kind === 'conflict' ? 'already-invited' : failure(result));
}

/** The pack checks and the accreditation check: drafts on Findings, nothing accepted. */
export async function runChecks(dealId: string): Promise<void> {
  guard(dealId);
  const result = await apiPost<{ created: number }>(`/v1/deals/${dealId}/spv/checks`, {});
  back(dealId, result.kind === 'ok' ? `ok-checks-${result.data.created}` : failure(result));
}

/** Freeze the investor view as its next version (the deal lead only). */
export async function publish(dealId: string): Promise<void> {
  guard(dealId);
  const result = await apiPost<{ version: number }>(`/v1/deals/${dealId}/spv/investor-view/publish`, {});
  back(dealId, result.kind === 'ok' ? `ok-published-${result.data.version}` : failure(result));
}
