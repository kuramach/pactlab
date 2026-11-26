import { NOTIFICATION_EVENTS, type NotificationEventType } from '@pactlab/domain';
import type { OutboundEmail } from '../email-login/email-sender';

/** What one notification email names: the pact, the event in plain words, and the link back. Never more (T-145 content rules). */
export interface EmailItem {
  readonly type: NotificationEventType;
  readonly dealName: string;
  readonly link: string;
}

/** Items listed in one digest; the rest are counted and wait in the inbox. */
export const DIGEST_LIST_LIMIT = 20;

const reason = (origin: string) => `You are on this pact in Pactlab. Choose what you are emailed about in Settings → Notifications: ${origin}/settings/notifications`;

/** "Act now": one email per event, at once. */
export function immediateEmail(to: string, item: EmailItem, origin: string): OutboundEmail {
  const title = NOTIFICATION_EVENTS[item.type].title;
  const url = `${origin}${item.link}`;
  return {
    to,
    subject: `${title} — ${item.dealName}`,
    text: [`${title}, on ${item.dealName}.`, '', `Open it in Pactlab: ${url}`, '', reason(origin), ''].join('\n'),
    content: { heading: title, paragraphs: [`On ${item.dealName}.`], action: { label: 'Open in Pactlab', url }, reason: reason(origin) },
  };
}

/** "For your information": one digest per person per slot, sent only when there is something new. */
export function digestEmail(to: string, items: readonly EmailItem[], origin: string): OutboundEmail {
  const listed = items.slice(0, DIGEST_LIST_LIMIT);
  const more = items.length - listed.length;
  const lines = listed.map((item) => `${item.dealName}: ${NOTIFICATION_EVENTS[item.type].title}`);
  const inbox = `${origin}/notifications`;
  const count = items.length === 1 ? '1 update' : `${items.length} updates`;
  return {
    to,
    subject: `Your Pactlab digest: ${count}`,
    text: [
      `What changed on your pacts since your last digest (${count}):`,
      '',
      ...listed.map((item) => `- ${item.dealName}: ${NOTIFICATION_EVENTS[item.type].title}\n  ${origin}${item.link}`),
      ...(more > 0 ? ['', `And ${more} more in Pactlab.`] : []),
      '',
      `See everything in Pactlab: ${inbox}`,
      '',
      reason(origin),
      '',
    ].join('\n'),
    content: {
      heading: 'Your Pactlab digest',
      paragraphs: [`What changed on your pacts since your last digest (${count}).`, ...(more > 0 ? [`And ${more} more in Pactlab.`] : [])],
      list: { heading: 'What changed', items: lines },
      action: { label: 'Open your notifications', url: inbox },
      reason: reason(origin),
    },
  };
}
