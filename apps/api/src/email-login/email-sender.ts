import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** A plain-text message. Bodies may carry one-time codes: never log them. */
export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Delivery port for sign-in, sign-up and operator emails. */
export interface EmailSender {
  readonly name: string;
  send(message: OutboundEmail): Promise<void>;
}

/**
 * Local development only: each message is written as an owner-only text
 * file under `LOCAL_MAIL_DIR` instead of being sent.
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
    await writeFile(join(this.dir, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.txt`), body, {
      mode: 0o600,
      flag: 'wx',
    });
  }
}

/** No delivery configured: nothing is sent, so code-based flows cannot complete. */
export class UnavailableEmailSender implements EmailSender {
  readonly name = 'unavailable';

  async send(): Promise<void> {
    throw new Error('Email delivery is not configured');
  }
}
