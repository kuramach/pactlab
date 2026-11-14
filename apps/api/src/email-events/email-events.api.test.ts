import 'reflect-metadata';
import type { SendEmailCommand} from '@aws-sdk/client-sesv2';
import { type SESv2Client } from '@aws-sdk/client-sesv2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { emailEvents, OperatorRequiredError, prismaExecutor } from '@pactlab/db';
import { newId } from '@pactlab/domain';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import type { WebFetcher, WebResponse } from '../common/safe-fetch';
import { emails } from '../email-login/emails';
import { EmailSuppressedError, SesEmailSender } from '../email-login/ses-email-sender';
import { DatabaseSuppressionList, recipientHash } from './email-events.service';
import { SnsVerifier } from './sns';
import { signedSns, TEST_SIGNING_PEM, TEST_TOPIC_ARN } from './testing';

const SECRET = 'test-secret-'.padEnd(48, 'x');
const mail = (address: string) => ({ messageId: `ses-${address.length}-${address.charCodeAt(0)}`, timestamp: '2026-11-14T05:00:00.000Z', destination: [address] });

/** T-109 acceptance, with the SES mailbox simulator's addresses: events in, the do-not-send list, refused sends. */
describe('SES delivery events', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const confirmed: string[] = [];
  const fetcher: WebFetcher = {
    async get(url: URL): Promise<WebResponse> {
      confirmed.push(url.toString());
      return { url, status: 200, contentType: 'text/xml', body: Buffer.from('<ConfirmSubscriptionResponse/>') };
    },
  };

  const post = async (body: unknown, contentType = 'text/plain; charset=UTF-8') => {
    const response = await app.inject({ method: 'POST', url: '/v1/email-events/sns', headers: { 'content-type': contentType, 'x-amz-sns-message-type': 'Notification' }, payload: typeof body === 'string' ? body : JSON.stringify(body) });
    return response.statusCode;
  };
  const notify = (id: string, event: unknown) => post(signedSns({ Type: 'Notification', MessageId: id, Message: JSON.stringify(event) }));

  beforeAll(async () => {
    db = await startTestDatabase();
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new DisabledIdentityVerifier(),
      logger: createLogger('api-test', { level: 'silent' }),
      emailLogin: { tokenSecret: SECRET },
      emailEvents: { verifier: new SnsVerifier(TEST_TOPIC_ARN, async () => TEST_SIGNING_PEM) },
      webFetcher: fetcher,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('confirms its own topic’s subscription, and refuses unsigned or foreign messages', async () => {
    const subscribe = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=t';
    expect(await post(signedSns({ Type: 'SubscriptionConfirmation', Message: 'confirm', SubscribeURL: subscribe, Token: 't' }))).toBe(200);
    expect(confirmed).toEqual([subscribe]);
    // A confirmation link anywhere but SNS is never fetched.
    expect(await post(signedSns({ Type: 'SubscriptionConfirmation', Message: 'confirm', SubscribeURL: 'https://169.254.169.254/latest', Token: 't' }))).toBe(403);
    expect(confirmed).toHaveLength(1);
    const forged = { ...signedSns({ Type: 'Notification', Message: JSON.stringify({ eventType: 'Complaint', mail: mail('ceo@victim.example'), complaint: { complainedRecipients: [{ emailAddress: 'ceo@victim.example' }] } }) }), Signature: 'AAAA' };
    expect(await post(forged)).toBe(403);
    expect(await post(signedSns({ Type: 'Notification', Message: '{}', TopicArn: 'arn:aws:sns:us-east-1:123456789012:other' }))).toBe(403);
    expect(await post('garbage')).toBe(403);
    expect(await new DatabaseSuppressionList(db.prisma, SECRET).check('ceo@victim.example')).toBeNull();
  });

  it('records a delivery, puts a hard bounce and a complaint on the list, and ignores a redelivery', async () => {
    expect(await notify('n-success', { eventType: 'Delivery', mail: mail('success@simulator.amazonses.com'), delivery: { recipients: ['success@simulator.amazonses.com'] } })).toBe(200);
    expect(await notify('n-bounce', { eventType: 'Bounce', mail: mail('bounce@simulator.amazonses.com'), bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'bounce@simulator.amazonses.com', diagnosticCode: 'smtp; 550 5.1.1 user unknown' }] } })).toBe(200);
    expect(await notify('n-bounce', { eventType: 'Bounce', mail: mail('bounce@simulator.amazonses.com'), bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'bounce@simulator.amazonses.com' }] } })).toBe(200);
    expect(await notify('n-complaint', { eventType: 'Complaint', mail: mail('complaint@simulator.amazonses.com'), complaint: { complainedRecipients: [{ emailAddress: 'complaint@simulator.amazonses.com' }], complaintFeedbackType: 'abuse' } })).toBe(200);
    // A transient bounce (mailbox full) is recorded, not suppressed.
    expect(await notify('n-soft', { eventType: 'Bounce', mail: mail('soft@example.com'), bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull', bouncedRecipients: [{ emailAddress: 'soft@example.com' }] } })).toBe(200);

    const list = new DatabaseSuppressionList(db.prisma, SECRET);
    expect(await list.check('success@simulator.amazonses.com')).toBeNull();
    expect(await list.check('Bounce@Simulator.AmazonSES.com')).toBe('HARD_BOUNCE');
    expect(await list.check('complaint@simulator.amazonses.com')).toBe('COMPLAINT');
    expect(await list.check('soft@example.com')).toBeNull();

    const rows = await db.owner.query<{ event_type: string; recipient_domain: string; recipient_hash: string }>('SELECT event_type, recipient_domain, recipient_hash FROM email_events ORDER BY received_at');
    expect(rows.rows.map((row) => row.event_type)).toEqual(['DELIVERY', 'BOUNCE', 'COMPLAINT', 'BOUNCE']);
    // No address is stored anywhere: only its keyed hash and domain.
    expect(rows.rows[1]?.recipient_hash).toBe(recipientHash(SECRET, 'bounce@simulator.amazonses.com'));
    const dump = JSON.stringify((await db.owner.query('SELECT * FROM email_events')).rows) + JSON.stringify((await db.owner.query('SELECT * FROM email_suppressions')).rows);
    expect(dump).not.toContain('bounce@');
    expect(dump).not.toContain('complaint@');
  });

  it('refuses a sign-in code to a suppressed address before calling SES; other sends carry the configuration set', async () => {
    const sent: SendEmailCommand[] = [];
    const client = { send: async (command: SendEmailCommand) => void sent.push(command) } as unknown as SESv2Client;
    const sender = new SesEmailSender(client, 'Pactlab <no-reply@pactlab.ai>', { configurationSetName: 'pactlab-dev', suppression: new DatabaseSuppressionList(db.prisma, SECRET) });
    await expect(sender.send(emails.signInCode('bounce@simulator.amazonses.com', '123456', 10))).rejects.toBeInstanceOf(EmailSuppressedError);
    await expect(sender.send(emails.signInCode('complaint@simulator.amazonses.com', '123456', 10))).rejects.toBeInstanceOf(EmailSuppressedError);
    expect(sent).toHaveLength(0);
    await sender.send(emails.signInCode('success@simulator.amazonses.com', '123456', 10));
    expect(sent.map((command) => command.input.ConfigurationSetName)).toEqual(['pactlab-dev']);
  });

  it('gives operators counts only', async () => {
    // Someone who is not a platform operator is refused; the ops CLI (no actor, schema owner) may read.
    await expect(emailEvents.health(prismaExecutor(db.prisma), newId(), 7)).rejects.toBeInstanceOf(OperatorRequiredError);
    const owner = await emailEvents.health({ query: (sql, params) => db.owner.query(sql, params as unknown[]) }, null, 7);
    expect(owner).toEqual({ counts: { DELIVERY: 1, BOUNCE: 2, COMPLAINT: 1, REJECT: 0, RENDERING_FAILURE: 0 }, suppressed: 2 });
  });
});
