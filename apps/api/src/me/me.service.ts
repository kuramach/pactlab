import { Inject, Injectable } from '@nestjs/common';
import { APP_DB_ROLE, type PrismaClient, type TokenIssuer } from '@pactlab/db';
import { PERMISSIONS, permissionsForOrganizationRole, type OrganizationRole } from '@pactlab/domain';
import { PRISMA } from '../tokens';
import type { MeResponse } from './me.schemas';

/**
 * Caller identity. Resolves the verified subject to its own user row and
 * active organization memberships using only RLS-visible rows, the same way
 * principal resolution does. No client-supplied organization id is consulted.
 */
@Injectable()
export class MeService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Only organizations reachable with the caller's sign-in method are listed,
   * so a picker never offers an organization the session cannot enter.
   */
  async resolve(subject: string, issuer: TokenIssuer): Promise<MeResponse | null> {
    return this.prisma.$transaction(async (tx) => {
      // Constant statement: no user input reaches SET ROLE.
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
      await tx.$executeRaw`SELECT set_config('app.auth_subject', ${subject}, true)`;
      const user = await tx.user.findUnique({
        where: { auth0Subject: subject },
        select: { id: true, displayName: true },
      });
      if (!user) return null;

      await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
      const memberships = await tx.organizationMembership.findMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          organization: { authMethod: issuer === 'AUTH0' ? 'AUTH0' : 'EMAIL_CODE' },
        },
        select: {
          role: true,
          organization: {
            select: { id: true, name: true, slug: true, auth0OrganizationId: true, authMethod: true },
          },
        },
        orderBy: { organization: { name: 'asc' } },
      });

      return {
        user,
        organizations: memberships.map(({ role, organization }) => {
          const granted = permissionsForOrganizationRole(role as OrganizationRole);
          return {
            ...organization,
            role: role as OrganizationRole,
            permissions: PERMISSIONS.filter((permission) => granted.has(permission)),
          };
        }),
      };
    });
  }
}
