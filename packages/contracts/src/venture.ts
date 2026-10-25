import { COMPANY_TYPES, COUNTERPARTY_TYPES, OFFER_STATUSES, ROUND_TYPES } from '@pactlab/domain';
import { z } from 'zod';

/** Venture Raise (T-083): the round, competing offers and the investor-facing view. */
const amount = z.string().regex(/^\d{1,18}(\.\d{1,4})?$/, 'A positive amount');
const fraction = z.string().regex(/^0(\.\d{1,6})?$/, 'A fraction below 1, e.g. 0.10');

export const ventureSettingsSchema = z.strictObject({
  expectedVersion: z.number().int().positive().nullable(),
  roundType: z.enum(ROUND_TYPES),
  currency: z.string().regex(/^[A-Z]{3}$/),
  targetPreMoney: amount,
  raiseAmount: amount,
  poolTargetPct: fraction,
  sector: z.enum(COMPANY_TYPES).nullable().default(null),
});
export type VentureSettingsInput = z.infer<typeof ventureSettingsSchema>;

const offerFields = {
  investorName: z.string().trim().min(1).max(200),
  counterpartyType: z.enum(COUNTERPARTY_TYPES),
  status: z.enum(OFFER_STATUSES).default('PROSPECT'),
  preMoney: amount.nullable().default(null),
  amount: amount.nullable().default(null),
  poolTargetPct: fraction.nullable().default(null),
  liquidationMultiple: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).default('1'),
  participating: z.boolean().default(false),
  investorBoardSeats: z.number().int().min(0).max(20).nullable().default(null),
  proRata: z.boolean().default(false),
  mfn: z.boolean().default(false),
  receivedOn: z.iso.date().nullable().default(null),
};
export const createOfferSchema = z.strictObject(offerFields);
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export const updateOfferSchema = z.strictObject({ expectedVersion: z.number().int().positive(), ...offerFields });
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
export const offerParamsSchema = z.strictObject({ dealId: z.uuid(), offerId: z.uuid() });

export const roundModelQuerySchema = z.strictObject({
  preMoney: z
    .string()
    .regex(/^\d{1,18}(\.\d{1,4})?(,\d{1,18}(\.\d{1,4})?){0,5}$/, 'Up to six comma-separated pre-money values')
    .optional(),
});
export const investorViewQuerySchema = z.strictObject({ offerId: z.uuid().optional() });

export interface VentureSettingsView {
  readonly roundType: (typeof ROUND_TYPES)[number];
  readonly currency: string;
  readonly targetPreMoney: string;
  readonly raiseAmount: string;
  readonly poolTargetPct: string;
  readonly sector: string | null;
  readonly version: number;
}

export interface OfferView {
  readonly id: string;
  readonly investorName: string;
  readonly counterpartyType: (typeof COUNTERPARTY_TYPES)[number];
  readonly status: (typeof OFFER_STATUSES)[number];
  readonly preMoney: string | null;
  readonly amount: string | null;
  readonly poolTargetPct: string | null;
  readonly liquidationMultiple: string;
  readonly participating: boolean;
  readonly investorBoardSeats: number | null;
  readonly proRata: boolean;
  readonly mfn: boolean;
  readonly receivedOn: string | null;
  readonly version: number;
}
