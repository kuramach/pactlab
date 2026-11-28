/**
 * Contact details (T-180, ADR 0064): how a number is read, how a value is masked for an admin, and the
 * one message every channel sends. Contact details are personal data: never logged, never in a
 * fixture, never sent to a model.
 */

export type ContactKind = 'EMAIL' | 'TELEGRAM' | 'WHATSAPP';

/** E.164 country codes of one and two digits; everything else is three (ITU-T E.164 assignments). */
const TWO_DIGIT_CODES = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66',
  '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
]);

/** How many digits of an E.164 number (without `+`) are its country code. The database's `app_contact_country_code_length` mirrors it. */
export function countryCodeLength(digits: string): 1 | 2 | 3 {
  if (digits.startsWith('1') || digits.startsWith('7')) return 1;
  return TWO_DIGIT_CODES.has(digits.slice(0, 2)) ? 2 : 3;
}

/** The countries offered first in the picker: Pactlab's launch markets (ADR 0056). Any E.164 number is accepted. */
export const PHONE_COUNTRIES = [
  { iso: 'US', name: 'United States', dial: '1' },
  { iso: 'GB', name: 'United Kingdom', dial: '44' },
  { iso: 'DE', name: 'Germany', dial: '49' },
  { iso: 'FR', name: 'France', dial: '33' },
  { iso: 'IN', name: 'India', dial: '91' },
  { iso: 'JP', name: 'Japan', dial: '81' },
] as const;

/**
 * A number in international format (E.164), or null. Spaces, dots, dashes and brackets are ignored;
 * a national trunk `0` after the country code (`+44 (0)7700…`) is dropped, as dialling would.
 * `dial` is the picker's country code, used when the number has no `+`.
 */
export function toE164(input: string, dial?: string): string | null {
  const raw = input.trim().replace(/\(0\)/g, '');
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/[^\d]/g, '');
  if (!raw.startsWith('+')) {
    if (!dial || !/^[1-9]\d{0,2}$/.test(dial)) return null;
    digits = dial + digits.replace(/^0+/, '');
  }
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  return `+${digits}`;
}

/** The value as an admin sees it: `+91 •••• ••12`, `k•••@example.com`, `Telegram ••42`. Same rule as `app_contact_mask`. */
export function maskContact(kind: ContactKind, value: string): string {
  if (kind === 'EMAIL') return `${value.slice(0, 1)}•••@${value.split('@')[1] ?? ''}`;
  if (kind === 'WHATSAPP') {
    const digits = value.replace(/^\+/, '');
    return `+${digits.slice(0, countryCodeLength(digits))} •••• ••${digits.slice(-2)}`;
  }
  return `Telegram ••${value.slice(-2)}`;
}

/** Normalized email, or null. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** The sender every channel uses (ADR 0064, branding: Kumar 2026-11-27). */
export const CHANNEL_SENDER = 'Pactlab';
export const CHANNEL_PREFIX = 'Pactlab:';
/** The profile description every provider holds: the tagline (EMAIL_BLURB). */
export const CHANNEL_ABOUT = 'Test the pact before you sign it.';

export type ChannelMessageKind = 'ACT_NOW' | 'TEST' | 'LINKED' | 'LINK_EXPIRED' | 'DISCONNECTED' | 'STOPPED' | 'CHAT_CONFIRM' | 'CHAT_LINKED';

/**
 * The words every channel sends, in one place, per locale. Content-free by rule: never a pact name,
 * an amount, a document or a person; only that something needs you, and a link (T-146's lock-screen rule).
 * English only until the app's catalogs arrive (T-172); a new locale is a new entry here.
 */
const CHANNEL_WORDS = {
  en: {
    ACT_NOW: 'A pact needs you. Open Pactlab to see what: {link}',
    TEST: 'This is a test message. Notifications will arrive here, with no deal details. {link}',
    LINKED: 'You are connected. Pactlab will tell you here when a pact needs you, with no deal details. Send /stop to disconnect.',
    LINK_EXPIRED: 'This link has expired or was already used. Open your Pactlab profile for a new one.',
    DISCONNECTED: 'You are disconnected. Pactlab will not message you here again.',
    STOPPED: 'You will get no more messages from Pactlab here. You can reconnect from your profile.',
    // Slack and Teams (T-181): the one-time "is this you?" before a link, and the reply once confirmed.
    CHAT_CONFIRM: 'Someone signed in to Pactlab with your email asked to get Pactlab alerts here. Is this you? Confirm to connect. The request expires in 10 minutes.',
    CHAT_LINKED: 'You are connected. Pactlab will tell you here when a pact needs you, with no deal details. You can disconnect from your Pactlab profile at any time.',
  },
} as const satisfies Record<string, Record<ChannelMessageKind, string>>;

export type ChannelLocale = keyof typeof CHANNEL_WORDS;

/** One message for any channel: always starts "Pactlab:", always the same words. */
export function channelMessage(kind: ChannelMessageKind, options: { link?: string; locale?: string } = {}): string {
  const words = CHANNEL_WORDS[(options.locale ?? 'en') as ChannelLocale] ?? CHANNEL_WORDS.en;
  const text = words[kind].replace('{link}', options.link ?? '').trim();
  return `${CHANNEL_PREFIX} ${text}`;
}

/** The button labels Slack and Teams messages carry (T-181): one per message, in the same words everywhere. */
export const CHAT_BUTTONS = { OPEN: 'Open Pactlab', CONFIRM: 'Yes, connect me' } as const;

/** The consent shown before a WhatsApp number is verified; stored with its time on the channel. */
export const WHATSAPP_CONSENT_TEXT =
  'I agree that Pactlab may send me WhatsApp messages when a pact needs me. Messages carry no deal details, only a link. Reply STOP at any time to end them.';

/** What a STOP reply looks like on WhatsApp (case and spaces ignored). */
export function isStopWord(text: string): boolean {
  return /^(stop|stopp|arrêt|arret|unsubscribe|cancel|end|quit)$/i.test(text.trim());
}
