import type { NotificationEventType } from '@pactlab/domain';
import { EMAIL_COPY, resolveEmailLocale, type EmailLocale } from '../email-login/email-catalog';
import type { OutboundEmail } from '../email-login/email-sender';

/** What one notification email names: the pact, the event in plain words, and the link back. Never more (T-145 content rules). */
export interface EmailItem {
  readonly type: NotificationEventType;
  readonly dealName: string;
  readonly link: string;
}

/**
 * The language one email is written in (T-174b): the recipient's own choice, then their organization's default, then
 * the pact's working language. The person's and organization's are stored with T-172b and slot in ahead of the pact's;
 * until then the pact's is the signal. A digest across pacts in different languages is written in English.
 */
export function emailLocaleOf(items: readonly { readonly workingLanguage: string | null }[], person: string | null = null, organization: string | null = null): EmailLocale {
  const pacts = new Set(items.map((item) => resolveEmailLocale(item.workingLanguage)));
  const pact = pacts.size === 1 ? [...pacts][0] : null;
  return resolveEmailLocale(person, organization, pact);
}

/** Items listed in one digest; the rest are counted and wait in the inbox. */
export const DIGEST_LIST_LIMIT = 20;

const settings = (origin: string) => `${origin}/settings/notifications`;

/** "Act now": one email per event, at once, in the recipient's language (T-174). */
export function immediateEmail(to: string, item: EmailItem, origin: string, locale: EmailLocale = 'en'): OutboundEmail {
  const copy = EMAIL_COPY[locale].notification;
  const title = copy.titles[item.type];
  const url = `${origin}${item.link}`;
  const reason = copy.reason(settings(origin));
  return {
    to,
    subject: `${title} — ${item.dealName}`,
    locale,
    text: [`${title}. ${copy.onPact(item.dealName)}`, '', copy.openText(url), '', reason, ''].join('\n'),
    content: { heading: title, paragraphs: [copy.onPact(item.dealName)], action: { label: copy.open, url }, reason },
  };
}

/** "For your information": one digest per person per slot, sent only when there is something new. */
export function digestEmail(to: string, items: readonly EmailItem[], origin: string, locale: EmailLocale = 'en'): OutboundEmail {
  const copy = EMAIL_COPY[locale];
  const listed = items.slice(0, DIGEST_LIST_LIMIT);
  const more = items.length - listed.length;
  const title = (item: EmailItem) => copy.notification.titles[item.type];
  const lines = listed.map((item) => `${item.dealName}: ${title(item)}`);
  const inbox = `${origin}/notifications`;
  const reason = copy.notification.reason(settings(origin));
  return {
    to,
    subject: copy.digest.subject(items.length),
    locale,
    text: [
      copy.digest.intro(items.length),
      '',
      ...listed.map((item) => `- ${item.dealName}: ${title(item)}\n  ${origin}${item.link}`),
      ...(more > 0 ? ['', copy.digest.more(more)] : []),
      '',
      copy.digest.seeAll(inbox),
      '',
      reason,
      '',
    ].join('\n'),
    content: {
      heading: copy.digest.heading,
      paragraphs: [copy.digest.intro(items.length), ...(more > 0 ? [copy.digest.more(more)] : [])],
      list: { heading: copy.digest.listHeading, items: lines },
      action: { label: copy.digest.open, url: inbox },
      reason,
    },
  };
}
