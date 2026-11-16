import { ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException, UnprocessableEntityException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { oauth, resolvePrincipal, type PrismaClient, type TokenIssuer } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyRequest } from 'fastify';
import type { ApiAccessTokens } from '../oauth/access-tokens';
import { API_TOKENS, IDENTITY_VERIFIER, PRISMA } from '../tokens';
import type { IdentityVerifier } from './identity';

const PUBLIC_ROUTE = 'pactlab:public';
/** Opt a route out of authentication (health checks only). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

const UNSCOPED_ROUTE = 'pactlab:unscoped';
/**
 * Admit verified tokens without an organization claim. Such requests carry an
 * unscoped principal and no tenant context. Caller identity (`GET /v1/me`) only.
 */
export const AllowUnscoped = () => SetMetadata(UNSCOPED_ROUTE, true);

const RECENT_SIGN_IN = 'pactlab:recent-sign-in';
/** How recent a sign-in sensitive actions need (T-112). */
export const RECENT_SIGN_IN_HOURS = 8;
/**
 * Sensitive actions (inviting people, connecting DocuSign or an AI assistant, billing,
 * deleting a pact) need a Pactlab sign-in under 8 hours old, however long the session
 * on a trusted device runs. Otherwise 422 RECENT_SIGN_IN_REQUIRED, and the web asks to sign in again.
 * Auth0 sessions follow the identity provider's own rules.
 */
export const RecentSignIn = () => SetMetadata(RECENT_SIGN_IN, true);

const NO_DEMO = 'pactlab:no-demo';
/**
 * Actions that reach outside Pactlab (sending invitations, DocuSign, connecting an AI
 * assistant or a live source, billing, deleting a pact) are refused to shared-demo sessions
 * (T-113) with 422 DEMO_NOT_AVAILABLE. Everything inside the pact stays open: it all resets.
 */
export const NoDemo = () => SetMetadata(NO_DEMO, true);

const API_ROUTE = 'pactlab:api';
/**
 * Open a route to OAuth API access tokens (T-128): GET and HEAD need `api:read`, anything else
 * `api:write`. This is the API's allowlist: every other route refuses API tokens with 403
 * NOT_AVAILABLE_TO_API (approvals, sign-offs, admin, billing, sign-in and OAuth stay app-only).
 */
export const ApiAccess = () => SetMetadata(API_ROUTE, true);
export const isApiRoute = (reflector: Reflector, handler: object): boolean => reflector.get<boolean>(API_ROUTE, handler as never) === true;

/** A verified subject, before (or independent of) organization scoping. */
export interface Principal {
  subject: string;
  /** Verified identity-provider organization claim; null for unscoped tokens. */
  externalOrganizationId: string | null;
  issuer: TokenIssuer;
  /** Email-code session id, when the token names one. */
  sessionId?: string;
  /** When the person signed in (Pactlab sessions only). */
  signedInAt?: Date;
  /** A shared-demo link opened the session (T-113). */
  demo?: boolean;
  /** The request came through the API with a person's OAuth grant (T-128), not an app session. */
  api?: { grantId: string; clientId: string };
}

export type AuthenticatedRequest = FastifyRequest & { tenant?: TenantContext; principal?: Principal };

/**
 * Global guard: every route requires a verified bearer token whose subject
 * holds an active membership in the token's organization. The resulting
 * tenant context is the only source of organization/deal scope downstream.
 * Routes marked `@AllowUnscoped()` also accept tokens without an organization
 * claim; those requests get a principal but never a tenant context.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IDENTITY_VERIFIER) private readonly verifier: IdentityVerifier,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_TOKENS) private readonly apiTokens: ApiAccessTokens | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
    if (!token) throw new UnauthorizedException();

    const identity = await this.verifier.verify(token);
    if (!identity) return this.apiCaller(context, request, token);

    const { subject, externalOrganizationId, issuer, sessionId, signedInAt, demo } = identity;
    const session = { ...(sessionId ? { sessionId } : {}), ...(signedInAt ? { signedInAt } : {}), ...(demo ? { demo } : {}) };
    if (demo && this.reflector.getAllAndOverride<boolean>(NO_DEMO, [context.getHandler(), context.getClass()])) {
      throw new UnprocessableEntityException({ code: 'DEMO_NOT_AVAILABLE' });
    }
    const needsRecent = this.reflector.getAllAndOverride<boolean>(RECENT_SIGN_IN, [context.getHandler(), context.getClass()]);
    if (needsRecent && issuer === 'PACTLAB' && (!signedInAt || Date.now() - signedInAt.getTime() > RECENT_SIGN_IN_HOURS * 3_600_000)) {
      throw new UnprocessableEntityException({ code: 'RECENT_SIGN_IN_REQUIRED' });
    }
    if (externalOrganizationId === null) {
      const allowUnscoped = this.reflector.getAllAndOverride<boolean>(UNSCOPED_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowUnscoped) throw new UnauthorizedException();
      request.principal = { subject, externalOrganizationId: null, issuer, ...session };
      return true;
    }

    const tenant = await resolvePrincipal(this.prisma, { subject, externalOrganizationId, issuer });
    if (!tenant) throw new UnauthorizedException();

    request.principal = { subject, externalOrganizationId, issuer, ...session };
    request.tenant = tenant;
    return true;
  }

  /**
   * A person's script or app with an API access token (T-128): audience-bound to the API, the
   * grant still active and the person still a member, API access on for the organization, the
   * route open to the API and the scope right for the method. The tenant is then resolved exactly
   * as for a session, so every role check, RLS policy and confidentiality rule applies unchanged.
   * There is no session, so routes needing a recent sign-in are refused too.
   */
  private async apiCaller(context: ExecutionContext, request: AuthenticatedRequest, token: string): Promise<boolean> {
    const claims = this.apiTokens ? await this.apiTokens.verify(token) : null;
    if (!claims) throw new UnauthorizedException();
    if (!this.reflector.getAllAndOverride<boolean>(API_ROUTE, [context.getHandler(), context.getClass()])) {
      throw new ForbiddenException({ code: 'NOT_AVAILABLE_TO_API', message: 'This action is only available in the Pactlab app.' });
    }
    const write = request.method !== 'GET' && request.method !== 'HEAD';
    if (!claims.scopes.includes(write ? 'api:write' : 'api:read')) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE', message: `This needs the ${write ? 'api:write' : 'api:read'} scope; sign in again asking for it.` });
    }
    const access = await oauth.grantAccess(this.prisma, claims.grantId, claims.subject);
    if (!access.active) throw new UnauthorizedException();
    if (!access.apiEnabled) throw new ForbiddenException({ code: 'API_DISABLED', message: 'API access is switched off for this organization.' });
    if (this.reflector.getAllAndOverride<boolean>(RECENT_SIGN_IN, [context.getHandler(), context.getClass()])) {
      throw new UnprocessableEntityException({ code: 'RECENT_SIGN_IN_REQUIRED' });
    }
    const tenant = await resolvePrincipal(this.prisma, { subject: claims.subject, externalOrganizationId: claims.organizationId, issuer: 'PACTLAB' });
    if (!tenant) throw new UnauthorizedException();
    request.principal = { subject: claims.subject, externalOrganizationId: claims.organizationId, issuer: 'PACTLAB', api: { grantId: claims.grantId, clientId: claims.clientId } };
    request.tenant = tenant;
    return true;
  }
}
