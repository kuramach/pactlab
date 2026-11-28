import { ALERT_CHANNELS, DIGEST_CADENCES, EMAIL_MODES } from '@pactlab/domain';
import { z } from 'zod';
import { pageQuerySchema } from './pagination';

/**
 * Pact activity notifications (T-145, ADR 0046): the inbox query, a person's settings and a
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

/**
 * Urgent alerts (T-146): which channels an "act now" item also reaches, and this browser's web push
 * subscription (PushSubscription.toJSON from the Push API, plus a readable device label).
 */
export const alertChannelsSchema = z
  .object({
    off: z.array(z.enum(ALERT_CHANNELS)).max(ALERT_CHANNELS.length),
  })
  .strict();
export type AlertChannelsBody = z.infer<typeof alertChannelsSchema>;

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.url({ protocol: /^https$/ }).max(2048),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/),
        auth: z.string().regex(/^[A-Za-z0-9_-]{21,24}={0,2}$/),
      })
      .strict(),
    /** "Safari on iPhone": derived by the web app from the user agent; the raw user agent is never stored. */
    label: z.string().trim().min(1).max(80),
  })
  .strict();
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionSchema>;
