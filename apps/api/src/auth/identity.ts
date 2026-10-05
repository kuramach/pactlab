import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Verified identity claims. Only fields the platform relies on. */
export interface VerifiedIdentity {
  subject: string;
  /** Null when the token carries no organization claim (caller has not picked an organization yet). */
  externalOrganizationId: string | null;
}

/** Internal identity adapter: Auth0 today, replaceable without touching callers. */
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
      if (organization === undefined) return { subject: payload.sub, externalOrganizationId: null };
      if (typeof organization !== 'string' || organization === '') return null;
      return { subject: payload.sub, externalOrganizationId: organization };
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
