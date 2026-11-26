import { DIGEST_CADENCES, EMAIL_MODES } from '@pactlab/domain';
import { z } from 'zod';
import { pageQuerySchema } from './pagination';

/**
 * Pact activity notifications (T-145, ADR 0045): the inbox query, a person's settings and a
 * per-pact override, from `@pactlab/domain`'s modes; the API validates every write here.
 */

export const notificationInboxQuerySchema = pageQuerySchema.extend({
  unread: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});
export type NotificationInboxQuery = z.infer<typeof notificationInboxQuerySchema>;

/** Minutes after local midnight. */
const minuteOfDay = z.number().int().min(0).max(1439);

export const notificationSettingsSchema = z
  .object({
    actNow: z.enum(EMAIL_MODES),
    fyi: z.enum(EMAIL_MODES),
    digest: z.enum(DIGEST_CADENCES),
    timeZone: z.string().regex(/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/),
    quietStart: minuteOfDay.nullable(),
    quietEnd: minuteOfDay.nullable(),
    actNowThroughQuiet: z.boolean(),
  })
  .strict()
  .refine((value) => (value.quietStart === null) === (value.quietEnd === null), { message: 'Set both ends of quiet hours, or neither', path: ['quietEnd'] });
export type NotificationSettingsBody = z.infer<typeof notificationSettingsSchema>;

export const pactNotificationOverrideSchema = z
  .object({
    actNow: z.enum(EMAIL_MODES).nullable(),
    fyi: z.enum(EMAIL_MODES).nullable(),
  })
  .strict();
export type PactNotificationOverrideBody = z.infer<typeof pactNotificationOverrideSchema>;
