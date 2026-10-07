import { randomInt } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { signup, type PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import { keyedHash, normalizeEmail } from '../email-login/client-address';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { emails } from '../email-login/emails';
import { LOGGER, PRISMA } from '../tokens';
import { isFreeMailAddress } from './free-mail';
import type { StartSignupBody } from './signup.schemas';

export const SIGNUP = Symbol('SIGNUP');

export interface SignupDependencies {
  readonly emailSender: EmailSender;
  readonly hashSecret: string;
  /** New organizations wait for an operator (`pnpm org:approve`) when true. */
  readonly requiresApproval: boolean;
  /** Who is told about new sign-ups; null: only `pnpm org:pending` shows them. */
  readonly operatorEmail: string | null;
  /** The app's /login, for "you already have an account" emails. */
  readonly loginUrl: string;
}

export interface SignupResult {
  status: 'ACTIVE' | 'PENDING_APPROVAL';
  organizationName: string;
}

const CODE_TTL_MINUTES = 10;

/**
 * Self-serve sign-up: an organization and its owner are created only when the
 * emailed code verifies. Organizations sign in with email codes; company SSO
 * (Auth0) is recorded as a request and set up by an operator.
 */
@Injectable()
export class SignupService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SIGNUP) private readonly deps: SignupDependencies,
  ) {}

  private codeHash(email: string, code: string): string {
    return keyedHash(this.deps.hashSecret, `signup:${normalizeEmail(email)}:${code}`);
  }

  /** Not awaited: response time must not reveal which email, if any, was sent. Never logs the body. */
  private deliver(message: OutboundEmail, kind: string): void {
    void this.deps.emailSender.send(message).catch((error: unknown) => {
      this.logger.error(
        { kind, sender: this.deps.emailSender.name, errorClass: error instanceof Error ? error.name : 'unknown' },
        'signup email delivery failed',
      );
    });
  }

  async start(body: StartSignupBody, clientAddress: string): Promise<void> {
    // Domain policy is public, so rejecting it reveals nothing about accounts.
    if (isFreeMailAddress(body.email)) throw new UnprocessableEntityException('WORK_EMAIL_REQUIRED');
    const email = normalizeEmail(body.email);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const begun = await signup.begin(this.prisma, {
      email,
      displayName: body.displayName,
      organizationName: body.organizationName,
      ssoRequested: body.ssoRequested,
      codeHash: this.codeHash(email, code),
      ipHash: keyedHash(this.deps.hashSecret, `ip:${clientAddress}`),
    });
    if (begun.kind === 'code') this.deliver(emails.signupCode(email, code, CODE_TTL_MINUTES), 'signup-code');
    if (begun.kind === 'existing-user') this.deliver(emails.signupExistingAccount(email, this.deps.loginUrl), 'signup-existing');
  }

  async verify(email: string, code: string): Promise<SignupResult> {
    const created = await signup.verify(this.prisma, {
      email: normalizeEmail(email),
      codeHash: this.codeHash(email, code),
      requiresApproval: this.deps.requiresApproval,
    });
    if (!created || created.status === 'SUSPENDED') throw new UnauthorizedException();
    if (created.status === 'PENDING_APPROVAL' && this.deps.operatorEmail) {
      this.deliver(
        emails.operatorNewSignup(this.deps.operatorEmail, {
          organizationName: created.organizationName,
          slug: created.slug,
          ownerName: created.ownerName,
          ownerEmail: normalizeEmail(email),
          ssoRequested: created.ssoRequested,
        }),
        'operator-new-signup',
      );
    }
    return { status: created.status, organizationName: created.organizationName };
  }
}
