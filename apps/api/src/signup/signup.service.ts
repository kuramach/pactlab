import { randomInt } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { invitationLinks, signup, type PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import { keyedHash, normalizeEmail } from '../email-login/client-address';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { emails } from '../email-login/emails';
import { hashToken } from '../invitations/invitations.service';
import type { PactlabTokens } from '../auth/pactlab-token';
import { LOGGER, PRISMA } from '../tokens';
import { isFreeMailAddress } from './free-mail';
import { BillingService } from '../billing/billing.service';
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
  /** Signs the first session of an active sign-up, as email sign-in does. */
  readonly tokens: PactlabTokens;
}

export interface SignupResult {
  status: 'ACTIVE' | 'PENDING_APPROVAL';
  organizationName: string;
  /** Present when the organization is active: the owner is signed in, no second code. */
  session?: { token: string; expiresAt: string; organizationId: string };
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
    @Inject(BillingService) private readonly billing: BillingService,
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

  /** A pending, unexpired pact invitation for this address. */
  private async invited(token: string | undefined, email: string): Promise<boolean> {
    if (!token) return false;
    return invitationLinks.validFor(this.prisma, hashToken(token), normalizeEmail(email));
  }

  async start(body: StartSignupBody, clientAddress: string): Promise<void> {
    // Any address may own an organization (Kumar, 2026-11-02): founders, solo advisors and small firms use personal
    // mailboxes. Company single sign-on is the exception: it needs the company's domain. The policy is public,
    // so refusing it reveals nothing about accounts. An invited seller may ask for anything.
    if (body.ssoRequested && isFreeMailAddress(body.email) && !(await this.invited(body.invitationToken, body.email))) {
      throw new UnprocessableEntityException({ code: 'WORK_EMAIL_FOR_SSO' });
    }
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

  async verify(email: string, code: string, invitationToken?: string, promo?: { code: string; ip: string }): Promise<SignupResult> {
    // An invitee's home organization is active at once: the inviting pact vouches for them.
    const invited = await this.invited(invitationToken, email);
    // So does a promo code that skips approval (T-087), checked before the organization exists.
    const promoCheck = promo ? await this.billing.checkPromo(promo.code, promo.ip) : null;
    if (promo && !promoCheck?.valid) throw new UnprocessableEntityException({ code: `PROMO_${promoCheck?.reason ?? 'UNKNOWN'}` });
    const created = await signup.verify(this.prisma, {
      email: normalizeEmail(email),
      codeHash: this.codeHash(email, code),
      requiresApproval: this.deps.requiresApproval && !invited && !promoCheck?.skipsApproval,
    });
    if (!created || created.status === 'SUSPENDED') throw new UnauthorizedException();
    if (promo && created.organizationId) {
      const redeemed = await this.billing.redeemForNewOrganization(promo.code, created.organizationId);
      if (redeemed !== 'REDEEMED') this.logger.warn({ reason: redeemed }, 'promo code not redeemed after sign-up');
    }
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
    if (!created.session) return { status: created.status, organizationName: created.organizationName };
    const token = await this.deps.tokens.issue({
      subject: created.session.subject,
      sessionId: created.session.sessionId,
      organizationId: created.organizationId,
      expiresAt: created.session.expiresAt,
    });
    return {
      status: created.status,
      organizationName: created.organizationName,
      session: { token, expiresAt: created.session.expiresAt.toISOString(), organizationId: created.organizationId },
    };
  }
}
