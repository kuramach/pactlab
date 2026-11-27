import { PROFILE_FIELD_KEYS } from '@pactlab/domain';
import { z } from 'zod';

/** The property's address, as typed or confirmed: "Street, City, State ZIP" (T-188). */
export const populateSchema = z.strictObject({ address: z.string().trim().min(5).max(200).optional() });
export type PopulateBody = z.infer<typeof populateSchema>;

/** What the reviewer accepts: the keys they kept, each with the value as shown or as they edited it. */
export const acceptSchema = z.strictObject({
  values: z
    .array(z.strictObject({ key: z.enum(PROFILE_FIELD_KEYS), value: z.string().trim().min(1).max(500) }))
    .min(1)
    .max(PROFILE_FIELD_KEYS.length)
    .refine((rows) => new Set(rows.map((row) => row.key)).size === rows.length, 'Each field once'),
});
export type AcceptBody = z.infer<typeof acceptSchema>;

export const photoParamsSchema = z.strictObject({ dealId: z.uuid(), index: z.coerce.number().int().min(0).max(11) });
