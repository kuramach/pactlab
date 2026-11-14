import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import { describe, expect, it } from 'vitest';
import { EmailSuppressedError, SesEmailSender } from './ses-email-sender';

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

  it('sends the branded HTML beside the text when there is one', async () => {
    const sent: SendEmailCommand[] = [];
    const client = { send: async (command: SendEmailCommand) => void sent.push(command) } as unknown as SESv2Client;
    await new SesEmailSender(client, 'Pactlab <no-reply@pactlab.ai>').send({ to: 'lead@example.com', subject: 'Your code', text: 'Code 123456', html: '<p>Code 123456</p>' });
    expect(sent[0]?.input.Content?.Simple?.Body).toEqual({ Text: { Data: 'Code 123456', Charset: 'UTF-8' }, Html: { Data: '<p>Code 123456</p>', Charset: 'UTF-8' } });
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

  it('names the environment’s configuration set on every send, so its events come back (T-109)', async () => {
    const sent: SendEmailCommand[] = [];
    const client = { send: async (command: SendEmailCommand) => void sent.push(command) } as unknown as SESv2Client;
    await new SesEmailSender(client, 'no-reply@pactlab.ai', { configurationSetName: 'pactlab-dev' }).send({ to: 'success@simulator.amazonses.com', subject: 'Code', text: 'Code 123456' });
    expect(sent[0]?.input.ConfigurationSetName).toBe('pactlab-dev');
  });

  it('refuses an address on the do-not-send list before calling SES, and sends anyway if the list cannot be read', async () => {
    const sent: SendEmailCommand[] = [];
    const client = { send: async (command: SendEmailCommand) => void sent.push(command) } as unknown as SESv2Client;
    const blocked = new SesEmailSender(client, 'no-reply@pactlab.ai', { suppression: { check: async () => 'HARD_BOUNCE' } });
    await expect(blocked.send({ to: 'bounce@simulator.amazonses.com', subject: 'Code', text: 'Code 123456' })).rejects.toBeInstanceOf(EmailSuppressedError);
    expect(sent).toHaveLength(0);
    const unreadable = new SesEmailSender(client, 'no-reply@pactlab.ai', { suppression: { check: async () => { throw new Error('database down'); } } });
    await unreadable.send({ to: 'lead@example.com', subject: 'Code', text: 'Code 123456' });
    expect(sent).toHaveLength(1);
  });
});
