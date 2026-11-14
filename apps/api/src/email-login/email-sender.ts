import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * What a message says, for its branded HTML version (BrandedEmailSender). The plain
 * text stays the source of truth; this mirrors it.
 */
export interface EmailContent {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** A one-time code, shown large. */
  readonly code?: string;
  /** The main link, shown as a button (its URL is also in the text). */
  readonly action?: { readonly label: string; readonly url: string };
  /** Small print under the body. */
  readonly footnote?: string;
  /** Several links, each a button with a line saying what it opens (e.g. a demo's buyer and seller views). */
  readonly links?: readonly { readonly label: string; readonly url: string; readonly detail: string }[];
  /** A short list under its own heading (e.g. what to try first). */
  readonly list?: { readonly heading: string; readonly items: readonly string[] };
  /** Why the person received this email; defaults to an action on their own account. */
  readonly reason?: string;
}

/** A message: plain text always, and HTML when it is branded. Bodies may carry one-time codes: never log them. */
/** The sending organization's look (T-123): on emails sent for it, never on Pactlab's own (codes, sign-up). */
export interface EmailBrand {
  readonly name: string;
  /** A public https PNG or JPEG; mail apps do not show SVG. Null prints the name. */
  readonly logoUrl: string | null;
  readonly accentColor: string | null;
}

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly content?: EmailContent;
  readonly brand?: EmailBrand;
}

/** Delivery port for sign-in, sign-up and operator emails. */
export interface EmailSender {
  readonly name: string;
  send(message: OutboundEmail): Promise<void>;
}

/**
 * Local development only: each message is written as an owner-only text
 * file under `LOCAL_MAIL_DIR` instead of being sent (and its HTML beside it).
 */
export class LocalFileEmailSender implements EmailSender {
  readonly name = 'local-file';
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async send(message: OutboundEmail): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const body = [`To: ${message.to}`, `Subject: ${message.subject}`, '', message.text, ''].join('\n');
    const name = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
    await writeFile(join(this.dir, `${name}.txt`), body, { mode: 0o600, flag: 'wx' });
    // The branded version beside it, to open in a browser.
    if (message.html) await writeFile(join(this.dir, `${name}.html`), message.html, { mode: 0o600, flag: 'wx' });
  }
}

/** No delivery configured: nothing is sent, so code-based flows cannot complete. */
export class UnavailableEmailSender implements EmailSender {
  readonly name = 'unavailable';

  async send(): Promise<void> {
    throw new Error('Email delivery is not configured');
  }
}
