import { pageQuerySchema } from '@pactlab/contracts';
import { ACCREDITATION_STATUSES, INVESTOR_SEAT_STATUSES } from '@pactlab/domain';
import { z } from 'zod';

/** An exit path as the organizer states it: the company's exit equity value ÷ the round's post-money. */
const multiple = z.string().trim().regex(/^\d{1,4}(\.\d{1,4})?$/, 'A multiple such as 0.5, 3 or 10').nullable();

export const vehicleBodySchema = z.strictObject({
  vehicleName: z.string().trim().min(1).max(200),
  downsideMultiple: multiple,
  baseMultiple: multiple,
  upsideMultiple: multiple,
});
export type VehicleBody = z.infer<typeof vehicleBodySchema>;

const https = z.url({ protocol: /^https$/ }).max(2000);
export const seatBodySchema = z.strictObject({
  label: z.string().trim().min(1).max(200),
  reference: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,30}$/, 'A short reference such as INV-03'),
  commitment: z.string().trim().regex(/^\d{1,15}(\.\d{1,2})?$/).nullable(),
  accreditationStatus: z.enum(ACCREDITATION_STATUSES).default('NOT_STARTED'),
});
export type SeatBody = z.infer<typeof seatBodySchema>;

/** Accreditation is tracked, never determined: a status, and where a specialist recorded it. */
export const seatUpdateSchema = z.strictObject({
  commitment: z.string().trim().regex(/^\d{1,15}(\.\d{1,2})?$/).nullable().optional(),
  status: z.enum(INVESTOR_SEAT_STATUSES).optional(),
  accreditationStatus: z.enum(ACCREDITATION_STATUSES).optional(),
  accreditationProvider: z.string().trim().min(1).max(200).nullable().optional(),
  accreditationUrl: https.nullable().optional(),
  accreditationEvidence: z.string().trim().min(1).max(500).nullable().optional(),
});
export type SeatUpdate = z.infer<typeof seatUpdateSchema>;

export const seatParamsSchema = z.strictObject({ dealId: z.uuid(), seatId: z.uuid() });
export const inviteBodySchema = z.strictObject({ email: z.email().max(320).transform((value) => value.trim().toLowerCase()) });
export type InviteBody = z.infer<typeof inviteBodySchema>;

export const seatsQuerySchema = pageQuerySchema.strict();
export type SeatsQuery = z.infer<typeof seatsQuerySchema>;
export const versionsQuerySchema = pageQuerySchema.strict();
export type VersionsQuery = z.infer<typeof versionsQuerySchema>;
