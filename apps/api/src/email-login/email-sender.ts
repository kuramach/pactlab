import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface SignInEmail {
  readonly to: string;
  readonly code: string;
  readonly expiresInMinutes: number;
}

/** Delivery port for sign-in codes. Implementations never log the code. */
export interface EmailSender {
  readonly name: string;
  sendSignInCode(message: SignInEmail): Promise<void>;
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

  async sendSignInCode(message: SignInEmail): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const body = [
      `To: ${message.to}`,
      'Subject: Your Pactlab sign-in code',
      '',
      `Your Pactlab sign-in code is ${message.code}.`,
      `It expires in ${message.expiresInMinutes} minutes and works once.`,
      'If you did not try to sign in, ignore this email.',
      '',
    ].join('\n');
    await writeFile(join(this.dir, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.txt`), body, {
      mode: 0o600,
      flag: 'wx',
    });
  }
}

/** No delivery configured: codes are never sent, so email-code sign-in cannot complete. */
export class UnavailableEmailSender implements EmailSender {
  readonly name = 'unavailable';

  async sendSignInCode(): Promise<void> {
    throw new Error('Email delivery is not configured');
  }
}
