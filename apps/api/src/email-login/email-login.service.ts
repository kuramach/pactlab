import { createHmac, randomInt } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { authSessions, emailLogin, type PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import type { Principal } from '../auth/auth.guard';
import type { PactlabTokens } from '../auth/pactlab-token';
import { LOGGER, PRISMA } from '../tokens';
import type { EmailSender } from './email-sender';

export const EMAIL_LOGIN = Symbol('EMAIL_LOGIN');

export interface EmailLoginDependencies {
  readonly tokens: PactlabTokens;
  readonly emailSender: EmailSender;
  /** Keys the code and IP hashes; the same secret that signs tokens. */
  readonly hashSecret: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: string;
  /** Null when the user must pick one of several organizations. */
  organizationId: string | null;
}

const CODE_TTL_MINUTES = 10;

const normalize = (email: string) => email.trim().toLowerCase();

/**
 * Pactlab email one-time-code sign-in for organizations that do not use
 * Auth0. Codes are random 6-digit numbers bound to the address by HMAC; the
 * database stores only the HMAC. Responses never reveal whether an address
 * exists, belongs to an email-code organization, or was rate limited.
 */
@Injectable()
export class EmailLoginService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(EMAIL_LOGIN) private readonly deps: EmailLoginDependencies,
  ) {}

  private hmac(value: string): string {
    return createHmac('sha256', this.deps.hashSecret).update(value, 'utf8').digest('hex');
  }

  private codeHash(email: string, code: string): string {
    return this.hmac(`code:${normalize(email)}:${code}`);
  }

  async start(email: string, ip: string): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge = await emailLogin.begin(this.prisma, {
      email: normalize(email),
      codeHash: this.codeHash(email, code),
      ipHash: this.hmac(`ip:${ip}`),
    });
    if (!challenge) return;
    // Not awaited: response time must not reveal whether a code was sent.
    void this.deps.emailSender
      .sendSignInCode({ to: normalize(email), code, expiresInMinutes: CODE_TTL_MINUTES })
      .catch((error: unknown) => {
        // Never log the code or the address.
        this.logger.error(
          { challengeId: challenge, sender: this.deps.emailSender.name, errorClass: error instanceof Error ? error.name : 'unknown' },
          'sign-in email delivery failed',
        );
      });
  }

  async verify(email: string, code: string): Promise<IssuedSession> {
    const session = await emailLogin.verify(this.prisma, {
      email: normalize(email),
      codeHash: this.codeHash(email, code),
    });
    if (!session) throw new UnauthorizedException();
    return this.issue(session.subject, session.sessionId, session.organizationId, session.expiresAt);
  }

  /** Move an email-code session into one of the caller's email-code organizations. */
  async selectOrganization(principal: Principal, organizationId: string): Promise<IssuedSession> {
    if (principal.issuer !== 'PACTLAB' || !principal.sessionId) throw new UnauthorizedException();
    const scoped = await authSessions.rescope(this.prisma, principal.sessionId, organizationId);
    if (!scoped) throw new UnauthorizedException();
    return this.issue(principal.subject, scoped.sessionId, organizationId, scoped.expiresAt);
  }

  async logout(principal: Principal): Promise<void> {
    if (principal.issuer === 'PACTLAB' && principal.sessionId) {
      await authSessions.revoke(this.prisma, principal.sessionId);
    }
  }

  private async issue(
    subject: string,
    sessionId: string,
    organizationId: string | null,
    expiresAt: Date,
  ): Promise<IssuedSession> {
    const token = await this.deps.tokens.issue({ subject, sessionId, organizationId, expiresAt });
    return { token, expiresAt: expiresAt.toISOString(), organizationId };
  }
}
