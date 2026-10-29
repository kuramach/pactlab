import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import type { EmailSender, OutboundEmail } from './email-sender';

/**
 * Deployed environments: Amazon SES (v2), from the environment's verified
 * identity. Credentials come from the task role, which may send only as that
 * identity. Addresses and bodies (which may carry one-time codes) are never
 * logged; a failure surfaces as an error without either.
 */
export class SesEmailSender implements EmailSender {
  readonly name = 'ses';

  constructor(
    private readonly client: SESv2Client,
    private readonly from: string,
  ) {}

  async send(message: OutboundEmail): Promise<void> {
    try {
      await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [message.to] },
          Content: { Simple: { Subject: { Data: message.subject, Charset: 'UTF-8' }, Body: { Text: { Data: message.text, Charset: 'UTF-8' } } } },
        }),
      );
    } catch (error) {
      // Deliberately no `cause`: SES error messages can contain the recipient address.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Email delivery failed (${error instanceof Error ? error.name : 'unknown'})`);
    }
  }
}
