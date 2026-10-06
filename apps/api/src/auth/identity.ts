import type { TokenIssuer } from '@pactlab/db';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Verified identity claims. Only fields the platform relies on. */
export interface VerifiedIdentity {
  subject: string;
  /** Null when the token carries no organization claim (caller has not picked an organization yet). */
  externalOrganizationId: string | null;
  /** Which sign-in method issued the token; each organization accepts exactly one. */
  issuer: TokenIssuer;
  /** Server-side session id (Pactlab email-code tokens only). */
  sessionId?: string;
}

/** Internal identity adapter: Auth0 or Pactlab email-code, replaceable without touching callers. */
export interface IdentityVerifier {
  verify(token: string): Promise<VerifiedIdentity | null>;
}

export interface JwtVerifierOptions {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey;
  /** Claim carrying the identity-provider organization (Auth0 Organizations: `org_id`). */
  organizationClaim?: string;
}

export class JwtIdentityVerifier implements IdentityVerifier {
  constructor(private readonly options: JwtVerifierOptions) {}

  async verify(token: string): Promise<VerifiedIdentity | null> {
    try {
      const { payload } = await jwtVerify(token, this.options.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['RS256'],
        clockTolerance: 5,
      });
      const organization = payload[this.options.organizationClaim ?? 'org_id'];
      if (typeof payload.sub !== 'string' || payload.sub === '') return null;
      if (organization === undefined)
        return { subject: payload.sub, externalOrganizationId: null, issuer: 'AUTH0' };
      if (typeof organization !== 'string' || organization === '') return null;
      return { subject: payload.sub, externalOrganizationId: organization, issuer: 'AUTH0' };
    } catch {
      return null;
    }
  }
}

/** Auth0 adapter: RS256 tokens verified against the tenant's published JWKS. */
export function createAuth0Verifier(domain: string, audience: string): IdentityVerifier {
  const issuer = `https://${domain}/`;
  return new JwtIdentityVerifier({
    issuer,
    audience,
    keys: createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`)),
  });
}

/**
 * Routes a token to the verifier for its issuer. The `iss` claim is read
 * unverified only to choose; the chosen verifier checks signature, issuer
 * and audience. Unknown issuers are rejected.
 */
export class CompositeIdentityVerifier implements IdentityVerifier {
  constructor(
    private readonly verifiers: { auth0: IdentityVerifier; pactlab: IdentityVerifier | null; pactlabIssuer: string },
  ) {}

  async verify(token: string): Promise<VerifiedIdentity | null> {
    let issuer: string | undefined;
    try {
      issuer = decodeJwt(token).iss;
    } catch {
      return null;
    }
    if (issuer === this.verifiers.pactlabIssuer) {
      return this.verifiers.pactlab ? this.verifiers.pactlab.verify(token) : null;
    }
    return this.verifiers.auth0.verify(token);
  }
}

/** Deployments without Auth0: no Auth0-issued token is ever accepted. */
export class DisabledIdentityVerifier implements IdentityVerifier {
  async verify(): Promise<VerifiedIdentity | null> {
    return null;
  }
}
