import { authSessions, type PrismaClient } from '@pactlab/db';
import { isUuid } from '@pactlab/domain';
import { jwtVerify, SignJWT } from 'jose';
import type { IdentityVerifier, VerifiedIdentity } from './identity';

export const PACTLAB_TOKEN_ISSUER = 'pactlab';
const AUDIENCE = 'pactlab-api';
const ORGANIZATION_CLAIM = 'pactlab_org';

export interface PactlabTokenClaims {
  subject: string;
  sessionId: string;
  /** Pactlab organization id; null until the user picks one. */
  organizationId: string | null;
  expiresAt: Date;
}

/**
 * Bearer tokens for email-code sessions: HS256, signed and verified only by
 * the API. Each names its server-side session, which is re-checked on every
 * request, so logout and revocation take effect immediately.
 */
export class PactlabTokens implements IdentityVerifier {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly prisma: PrismaClient,
  ) {
    if (secret.length < 32) throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters');
    this.key = new TextEncoder().encode(secret);
  }

  async issue(claims: PactlabTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId, ...(claims.organizationId ? { [ORGANIZATION_CLAIM]: claims.organizationId } : {}) })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(PACTLAB_TOKEN_ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(claims.subject)
      .setIssuedAt()
      .setExpirationTime(Math.floor(claims.expiresAt.getTime() / 1000))
      .sign(this.key);
  }

  async verify(token: string): Promise<VerifiedIdentity | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: PACTLAB_TOKEN_ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        clockTolerance: 5,
      });
      const organization = payload[ORGANIZATION_CLAIM];
      const sessionId = payload['sid'];
      if (typeof payload.sub !== 'string' || payload.sub === '') return null;
      if (typeof sessionId !== 'string' || !isUuid(sessionId)) return null;
      if (organization !== undefined && (typeof organization !== 'string' || !isUuid(organization))) return null;
      const organizationId = organization ?? null;
      const active = await authSessions.isActive(this.prisma, { sessionId, subject: payload.sub, organizationId });
      if (!active) return null;
      return { subject: payload.sub, externalOrganizationId: organizationId, issuer: 'PACTLAB', sessionId };
    } catch {
      return null;
    }
  }
}
