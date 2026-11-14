import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import type { Logger } from '@pactlab/observability';
import type { EmailSender, OutboundEmail } from './email-sender';

/** The in-app do-not-send list (T-109): the reason an address may not be mailed, or null. */
export interface SuppressionList {
  check(address: string): Promise<'HARD_BOUNCE' | 'COMPLAINT' | null>;
}

/** Refused before SES was called: the address hard-bounced or complained (T-109). */
export class EmailSuppressedError extends Error {
  constructor(readonly reason: 'HARD_BOUNCE' | 'COMPLAINT') {
    super(`Email not sent: the address is on the do-not-send list (${reason})`);
    this.name = 'EmailSuppressedError';
  }
}

/**
 * Deployed environments: Amazon SES (v2), from the environment's verified
 * identity. Credentials come from the task role, which may send only as that
 * identity. Addresses and bodies (which may carry one-time codes) are never
 * logged; a failure surfaces as an error without either.
 *
 * Every send names the environment's configuration set, so its bounce and
 * complaint events come back to this environment (T-109), and an address on
 * the do-not-send list is refused first. If that check itself fails, the email
 * is sent: SES account-level suppression stays the floor.
 */
export class SesEmailSender implements EmailSender {
  readonly name = 'ses';

  constructor(
    private readonly client: SESv2Client,
    private readonly from: string,
    private readonly options: { configurationSetName?: string; suppression?: SuppressionList; logger?: Logger } = {},
  ) {}

  private async suppressed(to: string): Promise<'HARD_BOUNCE' | 'COMPLAINT' | null> {
    if (!this.options.suppression) return null;
    try {
      return await this.options.suppression.check(to);
    } catch (error) {
      this.options.logger?.warn({ errorClass: error instanceof Error ? error.name : 'unknown' }, 'suppression check failed; sending anyway');
      return null;
    }
  }

  async send(message: OutboundEmail): Promise<void> {
    const reason = await this.suppressed(message.to);
    if (reason) {
      this.options.logger?.warn({ reason, domain: message.to.slice(message.to.lastIndexOf('@') + 1) }, 'email refused: address on the do-not-send list');
      throw new EmailSuppressedError(reason);
    }
    try {
      await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [message.to] },
          ...(this.options.configurationSetName ? { ConfigurationSetName: this.options.configurationSetName } : {}),
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              // Plain text always; the branded HTML alongside when there is one (mail apps pick).
              Body: { Text: { Data: message.text, Charset: 'UTF-8' }, ...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}) },
            },
          },
        }),
      );
    } catch (error) {
      // Deliberately no `cause`: SES error messages can contain the recipient address.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Email delivery failed (${error instanceof Error ? error.name : 'unknown'})`);
    }
  }
}
