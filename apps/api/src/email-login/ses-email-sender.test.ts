import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import { describe, expect, it } from 'vitest';
import { SesEmailSender } from './ses-email-sender';

describe('SesEmailSender', () => {
  it('sends a plain-text message from the configured identity', async () => {
    const sent: SendEmailCommand[] = [];
    const client = { send: async (command: SendEmailCommand) => void sent.push(command) } as unknown as SESv2Client;
    await new SesEmailSender(client, 'Pactlab <no-reply@pactlab.ai>').send({ to: 'lead@example.com', subject: 'Your code', text: 'Code 123456' });
    expect(sent[0]).toBeInstanceOf(SendEmailCommand);
    expect(sent[0]?.input).toMatchObject({
      FromEmailAddress: 'Pactlab <no-reply@pactlab.ai>',
      Destination: { ToAddresses: ['lead@example.com'] },
      Content: { Simple: { Subject: { Data: 'Your code' }, Body: { Text: { Data: 'Code 123456' } } } },
    });
  });

  it('fails without echoing the address or the body', async () => {
    const client = {
      send: async () => {
        throw Object.assign(new Error('Email address is not verified: lead@example.com'), { name: 'MessageRejected' });
      },
    } as unknown as SESv2Client;
    const failure = new SesEmailSender(client, 'no-reply@pactlab.ai').send({ to: 'lead@example.com', subject: 'Your code', text: 'Code 123456' });
    await expect(failure).rejects.toThrow('Email delivery failed (MessageRejected)');
    await expect(failure).rejects.not.toThrow(/lead@example|123456/);
  });
});
