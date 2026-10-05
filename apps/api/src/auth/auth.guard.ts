import { Inject, Injectable, SetMetadata, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolvePrincipal, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyRequest } from 'fastify';
import { IDENTITY_VERIFIER, PRISMA } from '../tokens';
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

/** A verified subject, before (or independent of) organization scoping. */
export interface Principal {
  subject: string;
  /** Verified identity-provider organization claim; null for unscoped tokens. */
  externalOrganizationId: string | null;
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
    if (!token) throw new UnauthorizedException();

    const identity = await this.verifier.verify(token);
    if (!identity) throw new UnauthorizedException();

    const { subject, externalOrganizationId } = identity;
    if (externalOrganizationId === null) {
      const allowUnscoped = this.reflector.getAllAndOverride<boolean>(UNSCOPED_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowUnscoped) throw new UnauthorizedException();
      request.principal = { subject, externalOrganizationId: null };
      return true;
    }

    const tenant = await resolvePrincipal(this.prisma, { subject, externalOrganizationId });
    if (!tenant) throw new UnauthorizedException();

    request.principal = { subject, externalOrganizationId };
    request.tenant = tenant;
    return true;
  }
}
