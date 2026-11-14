import { z } from 'zod';
import type { EmailEventType } from '@pactlab/db';

/**
 * SES event publishing (configuration-set events, T-109): what one notification says about each
 * recipient. Only the fields Pactlab records are read; the rest of the payload is ignored.
 */
const recipient = z.object({ emailAddress: z.string().max(320) }).passthrough();
const sesEventSchema = z.object({
  eventType: z.enum(['Bounce', 'Complaint', 'Delivery', 'Reject', 'Rendering Failure']),
  mail: z.object({ messageId: z.string().max(200), timestamp: z.string().max(64), destination: z.array(z.string().max(320)).max(50) }).passthrough(),
  bounce: z
    .object({
      bounceType: z.string().max(40),
      bounceSubType: z.string().max(60).optional(),
      timestamp: z.string().max(64).optional(),
      bouncedRecipients: z.array(recipient.extend({ diagnosticCode: z.string().optional(), status: z.string().max(20).optional() })).max(50),
    })
    .passthrough()
    .optional(),
  complaint: z.object({ timestamp: z.string().max(64).optional(), complainedRecipients: z.array(recipient).max(50), complaintFeedbackType: z.string().max(60).optional() }).passthrough().optional(),
  delivery: z.object({ timestamp: z.string().max(64).optional(), recipients: z.array(z.string().max(320)).max(50) }).passthrough().optional(),
});

export interface RecipientEvent {
  type: EmailEventType;
  address: string;
  sesMessageId: string;
  bounceType: string | null;
  bounceSubtype: string | null;
  diagnostic: string | null;
  occurredAt: Date;
}

const TYPES: Record<z.infer<typeof sesEventSchema>['eventType'], EmailEventType> = {
  Bounce: 'BOUNCE',
  Complaint: 'COMPLAINT',
  Delivery: 'DELIVERY',
  Reject: 'REJECT',
  'Rendering Failure': 'RENDERING_FAILURE',
};

const when = (...values: (string | undefined)[]) => {
  for (const value of values) {
    const date = value ? new Date(value) : null;
    if (date && !Number.isNaN(date.getTime())) return date;
  }
  return new Date();
};

/** The SMTP diagnostic, minus any address it quotes. */
const clean = (diagnostic: string | undefined) => (diagnostic ? diagnostic.replace(/[^\s<>@]+@[^\s<>@]+/g, '<address>').slice(0, 500) : null);

/** One event per recipient; null for a message that is not an SES event Pactlab records. */
export function parseSesEvent(messageText: string): RecipientEvent[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(messageText);
  } catch {
    return null;
  }
  const parsed = sesEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data;
  const type = TYPES[event.eventType];
  const base = { type, sesMessageId: event.mail.messageId, bounceType: null, bounceSubtype: null, diagnostic: null };
  if (type === 'BOUNCE' && event.bounce) {
    const at = when(event.bounce.timestamp, event.mail.timestamp);
    return event.bounce.bouncedRecipients.map((r) => ({ ...base, address: r.emailAddress, bounceType: event.bounce?.bounceType ?? null, bounceSubtype: event.bounce?.bounceSubType ?? null, diagnostic: clean(r.diagnosticCode), occurredAt: at }));
  }
  if (type === 'COMPLAINT' && event.complaint) {
    const at = when(event.complaint.timestamp, event.mail.timestamp);
    return event.complaint.complainedRecipients.map((r) => ({ ...base, address: r.emailAddress, diagnostic: event.complaint?.complaintFeedbackType ? `feedback: ${event.complaint.complaintFeedbackType}` : null, occurredAt: at }));
  }
  if (type === 'DELIVERY' && event.delivery) {
    const at = when(event.delivery.timestamp, event.mail.timestamp);
    return event.delivery.recipients.map((address) => ({ ...base, address, occurredAt: at }));
  }
  if (type === 'REJECT' || type === 'RENDERING_FAILURE') return event.mail.destination.map((address) => ({ ...base, address, occurredAt: when(event.mail.timestamp) }));
  return null;
}

/** "Name <a@b.c>" or "a@b.c" → "a@b.c", lower-cased. */
export function bareAddress(value: string): string | null {
  const address = (/<([^<>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}
