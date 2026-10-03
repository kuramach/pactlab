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

export type AuthenticatedRequest = FastifyRequest & { tenant?: TenantContext };

/**
 * Global guard: every route requires a verified bearer token whose subject
 * holds an active membership in the token's organization. The resulting
 * tenant context is the only source of organization/deal scope downstream.
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

    const tenant = await resolvePrincipal(this.prisma, identity);
    if (!tenant) throw new UnauthorizedException();

    request.tenant = tenant;
    return true;
  }
}
