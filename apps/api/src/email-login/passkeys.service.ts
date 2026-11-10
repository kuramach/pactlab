import { randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { PasskeyOptionsView, PasskeysView } from '@pactlab/contracts';
import { passkeys, type PasskeyAccount, type PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Principal } from '../auth/auth.guard';
import { LOGGER, PRISMA } from '../tokens';
import { keyedHash } from './client-address';
import { EMAIL_LOGIN, type EmailLoginDependencies, type IssuedSession } from './email-login.service';
import { emails } from './emails';
import type { TrustChoice } from './email-login.schemas';
import { applyTrust } from './trust';

/** Where passkeys are bound (ADR 0023): the web host, and the web origin the browser reports. */
export interface WebAuthnRelyingParty {
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
}

const challenge = () => randomBytes(32).toString('base64url');

/**
 * Passkey sign-in for email-code organizations (T-108). WebAuthn ceremonies via
 * @simplewebauthn/server; every stored state change goes through the pactlab_auth
 * functions in packages/db. Discoverable credentials with user verification required,
 * no attestation. A passkey sign-in opens exactly the session an email code opens.
 */
@Injectable()
export class PasskeysService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(EMAIL_LOGIN) private readonly deps: EmailLoginDependencies,
  ) {}

  private get rp(): WebAuthnRelyingParty {
    return this.deps.webauthn;
  }

  // --- Signing in (no session yet) -------------------------------------------------------

  async signInOptions(ip: string): Promise<PasskeyOptionsView> {
    const options = await generateAuthenticationOptions({ rpID: this.rp.rpId, challenge: challenge(), userVerification: 'required', timeout: 120_000 });
    const challengeId = await passkeys.beginChallenge(this.prisma, { purpose: 'SIGN_IN', sessionId: null, challenge: options.challenge, ipHash: keyedHash(this.deps.hashSecret, `ip:${ip}`) });
    // Rate limited: the same answer as any other failure.
    if (!challengeId) throw new UnauthorizedException();
    return { challengeId, options: options as unknown as Record<string, unknown> };
  }

  /** A session token, or a uniform 401 whatever went wrong. */
  async signIn(challengeId: string, response: AuthenticationResponseJSON, trust: TrustChoice = '8h', device?: string): Promise<IssuedSession> {
    const expected = await passkeys.takeChallenge(this.prisma, { challengeId, purpose: 'SIGN_IN', sessionId: null });
    const stored = expected ? await passkeys.lookup(this.prisma, response.id) : null;
    if (!expected || !stored) throw new UnauthorizedException();
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: expected,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.rpId,
        credential: { id: response.id, publicKey: stored.publicKey, counter: stored.counter, transports: stored.transports },
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.warn({ errorClass: error instanceof Error ? error.name : 'unknown' }, 'passkey sign-in not verified');
      throw new UnauthorizedException();
    }
    if (!verified.verified) throw new UnauthorizedException();
    const session = await passkeys.login(this.prisma, { credentialId: response.id, newCounter: verified.authenticationInfo.newCounter });
    if (!session) throw new UnauthorizedException();
    const expiresAt = await applyTrust(this.prisma, session, trust, device);
    const token = await this.deps.tokens.issue({ subject: session.subject, sessionId: session.sessionId, organizationId: session.organizationId, expiresAt });
    return { token, expiresAt: expiresAt.toISOString(), organizationId: session.organizationId };
  }

  // --- The signed-in user's passkeys --------------------------------------------------------

  /** Passkeys are for Pactlab's own (email-code) sessions; an Auth0 sign-in manages its own. Rule failures are 422s with a code (problem-details filter). */
  private async account(principal: Principal): Promise<{ sessionId: string; account: PasskeyAccount }> {
    if (principal.issuer !== 'PACTLAB' || !principal.sessionId) throw new UnprocessableEntityException({ code: 'PASSKEYS_EMAIL_CODE_ONLY' });
    const account = await passkeys.account(this.prisma, principal.sessionId);
    if (!account) throw new UnauthorizedException();
    return { sessionId: principal.sessionId, account };
  }

  private static recent(account: PasskeyAccount): boolean {
    return account.signedInAt.getTime() > Date.now() - 15 * 60_000;
  }

  async list(principal: Principal): Promise<PasskeysView> {
    const { sessionId, account } = await this.account(principal);
    const stored = await passkeys.list(this.prisma, sessionId);
    return {
      passkeys: stored.map((key) => ({ id: key.id, name: key.name, createdAt: key.createdAt.toISOString(), lastUsedAt: key.lastUsedAt?.toISOString() ?? null, transports: key.transports })),
      canAdd: PasskeysService.recent(account) && stored.length < 10,
      offer: stored.length === 0 && !account.offerDismissed,
    };
  }

  async registrationOptions(principal: Principal): Promise<PasskeyOptionsView> {
    const { sessionId, account } = await this.account(principal);
    if (!PasskeysService.recent(account)) throw new UnprocessableEntityException({ code: 'REAUTH_REQUIRED' });
    const existing = await passkeys.list(this.prisma, sessionId);
    const options = await generateRegistrationOptions({
      rpName: this.rp.rpName,
      rpID: this.rp.rpId,
      // The user handle is the user id: no email or name inside the credential.
      userID: new Uint8Array(Buffer.from(account.userId.replace(/-/g, ''), 'hex')),
      userName: account.email ?? account.displayName,
      userDisplayName: account.displayName,
      challenge: challenge(),
      timeout: 120_000,
      attestationType: 'none',
      excludeCredentials: existing.map((key) => ({ id: key.credentialId, transports: key.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    const challengeId = await passkeys.beginChallenge(this.prisma, { purpose: 'REGISTER', sessionId, challenge: options.challenge, ipHash: null });
    if (!challengeId) throw new UnprocessableEntityException({ code: 'REAUTH_REQUIRED' });
    return { challengeId, options: options as unknown as Record<string, unknown> };
  }

  async register(principal: Principal, challengeId: string, response: RegistrationResponseJSON, name: string): Promise<PasskeysView> {
    const { sessionId, account } = await this.account(principal);
    const expected = await passkeys.takeChallenge(this.prisma, { challengeId, purpose: 'REGISTER', sessionId });
    if (!expected) throw new UnprocessableEntityException({ code: 'PASSKEY_NOT_VERIFIED' });
    let verified;
    try {
      verified = await verifyRegistrationResponse({ response, expectedChallenge: expected, expectedOrigin: this.rp.origin, expectedRPID: this.rp.rpId, requireUserVerification: true });
    } catch (error) {
      this.logger.warn({ errorClass: error instanceof Error ? error.name : 'unknown' }, 'passkey registration not verified');
      throw new UnprocessableEntityException({ code: 'PASSKEY_NOT_VERIFIED' });
    }
    if (!verified.verified) throw new UnprocessableEntityException({ code: 'PASSKEY_NOT_VERIFIED' });
    const { credential } = verified.registrationInfo;
    const id = await passkeys.register(this.prisma, {
      sessionId,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? [],
      name,
    });
    if (!id) throw new UnprocessableEntityException({ code: 'PASSKEY_REFUSED' });
    this.notify(account, 'added', name);
    return this.list(principal);
  }

  async remove(principal: Principal, passkeyId: string): Promise<PasskeysView> {
    const { sessionId, account } = await this.account(principal);
    const name = await passkeys.revoke(this.prisma, { sessionId, passkeyId });
    if (name === null) throw new UnprocessableEntityException({ code: 'PASSKEY_NOT_FOUND' });
    this.notify(account, 'removed', name);
    return this.list(principal);
  }

  async dismissOffer(principal: Principal): Promise<void> {
    const { sessionId } = await this.account(principal);
    await passkeys.dismissOffer(this.prisma, sessionId);
  }

  /** The security email; delivery failure never undoes the change (it is audited either way). */
  private notify(account: PasskeyAccount, change: 'added' | 'removed', name: string): void {
    if (!account.email) return;
    const settingsUrl = new URL('/settings#sign-in', this.rp.origin).toString();
    void this.deps.emailSender.send(emails.passkeyChanged(account.email, change, name, settingsUrl)).catch((error: unknown) => {
      this.logger.error({ sender: this.deps.emailSender.name, errorClass: error instanceof Error ? error.name : 'unknown' }, 'passkey notice delivery failed');
    });
  }
}
