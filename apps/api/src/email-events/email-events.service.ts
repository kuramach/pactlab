import { Inject, Injectable } from '@nestjs/common';
import { emailEvents, prismaExecutor, type PrismaClient, type SqlExecutor, type SuppressionReason } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import type { WebFetcher } from '../common/safe-fetch';
import { keyedHash } from '../email-login/client-address';
import { LOGGER, PRISMA } from '../tokens';
import { bareAddress, parseSesEvent } from './ses-event';
import { isSnsUrl, SnsVerificationError, type SnsVerifier } from './sns';

export const EMAIL_EVENTS_SETTINGS = Symbol('EMAIL_EVENTS_SETTINGS');

export interface EmailEventsSettings {
  /** Null when this environment has no SES event topic (local, tests without one): the endpoint refuses everything. */
  verifier: SnsVerifier | null;
  /** Confirms the topic's subscription (a GET of its SubscribeURL). */
  fetcher: WebFetcher;
  hashSecret: string;
}

/** The keyed hash an address is known by: the same in the consumer and the sender. */
export const recipientHash = (secret: string, address: string) => keyedHash(secret, `mail:${address.trim().toLowerCase()}`);

/**
 * SES delivery events (T-109, ADR 0032): verified SNS notifications become recorded events, and a
 * hard bounce or a complaint puts the address on the do-not-send list. Never on the sending path:
 * if this fails, sending carries on and SES account-level suppression still applies.
 */
@Injectable()
export class EmailEventsService {
  private readonly sql: SqlExecutor;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(EMAIL_EVENTS_SETTINGS) private readonly settings: EmailEventsSettings,
  ) {
    this.sql = prismaExecutor(prisma);
  }

  /** Returns false for a message that is not a verified one from this environment's topic. */
  async receive(body: unknown): Promise<boolean> {
    if (!this.settings.verifier) return false;
    let message;
    try {
      message = await this.settings.verifier.verify(body);
    } catch (error) {
      this.logger.warn({ reason: error instanceof SnsVerificationError ? error.reason : 'unknown' }, 'email event refused');
      return false;
    }
    if (message.Type === 'SubscriptionConfirmation') {
      // Only an SNS confirmation link, fetched through the SSRF-safe fetcher.
      if (!message.SubscribeURL || !isSnsUrl(message.SubscribeURL, /^\/$/)) return false;
      const response = await this.settings.fetcher.get(new URL(message.SubscribeURL), { maxBytes: 64 * 1024, accept: 'text/xml' });
      this.logger.info({ status: response.status, topic: message.TopicArn }, 'email events subscription confirmed');
      return response.status === 200;
    }
    if (message.Type === 'UnsubscribeConfirmation') {
      this.logger.warn({ topic: message.TopicArn }, 'email events unsubscribed');
      return true;
    }
    const recipients = parseSesEvent(message.Message);
    if (!recipients) {
      this.logger.warn({ snsMessageId: message.MessageId }, 'email event not an SES event; ignored');
      return true;
    }
    for (const recipient of recipients) {
      const address = bareAddress(recipient.address);
      if (!address) continue;
      const fresh = await emailEvents.record(this.sql, {
        type: recipient.type,
        recipientHash: recipientHash(this.settings.hashSecret, address),
        recipientDomain: address.slice(address.lastIndexOf('@') + 1),
        sesMessageId: recipient.sesMessageId,
        snsMessageId: message.MessageId,
        bounceType: recipient.bounceType,
        bounceSubtype: recipient.bounceSubtype,
        diagnostic: recipient.diagnostic,
        occurredAt: recipient.occurredAt,
      });
      // Every event, structured, without the address.
      this.logger.info(
        { event: recipient.type, bounceType: recipient.bounceType, bounceSubtype: recipient.bounceSubtype, domain: address.slice(address.lastIndexOf('@') + 1), sesMessageId: recipient.sesMessageId, duplicate: !fresh },
        'email event',
      );
    }
    return true;
  }
}

/** The sender's check (`SesEmailSender`): is this address on the do-not-send list? */
export class DatabaseSuppressionList {
  private readonly sql: SqlExecutor;

  constructor(
    prisma: PrismaClient,
    private readonly hashSecret: string,
  ) {
    this.sql = prismaExecutor(prisma);
  }

  check(address: string): Promise<SuppressionReason | null> {
    return emailEvents.suppressed(this.sql, recipientHash(this.hashSecret, bareAddress(address) ?? address));
  }
}
