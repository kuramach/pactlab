import { TenantAccessDeniedError, isUuid, type DealId, type OrganizationId, type OrganizationRole, type TenantContext, type UserId } from '@pactlab/domain';
import type { PrismaClient, TransactionClient } from './client';

/** The only database role application code may act as. It cannot bypass RLS. */
export const APP_DB_ROLE = 'pactlab_app';

function assertUuids(values: readonly string[]): void {
  if (!values.every(isUuid)) throw new TenantAccessDeniedError('Invalid tenant identifier');
}

async function applySettings(tx: TransactionClient, settings: Record<string, string>): Promise<void> {
  // Constant statement: no user input reaches SET ROLE.
  await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
  for (const [key, value] of Object.entries(settings)) {
    await tx.$executeRaw`SELECT set_config(${key}, ${value}, true)`;
  }
}

function dealIdsLiteral(dealIds: readonly string[]): string {
  assertUuids(dealIds);
  return `{${dealIds.join(',')}}`;
}

/**
 * Run `fn` in one transaction as `pactlab_app` with the verified tenant
 * context applied. Every application query goes through this function.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  context: TenantContext,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  assertUuids([context.organizationId, context.userId]);
  return prisma.$transaction(async (tx) => {
    await applySettings(tx, {
      'app.organization_id': context.organizationId,
      'app.user_id': context.userId,
      'app.deal_ids': dealIdsLiteral(context.dealIds),
    });
    return fn(tx);
  });
}

export interface PrincipalClaims {
  /** Verified `sub` claim. */
  subject: string;
  /** Verified identity-provider organization claim (Auth0 `org_id`). */
  externalOrganizationId: string;
}

/**
 * Resolve a verified token's claims to a tenant context using only RLS-visible
 * rows: own user by subject, own active memberships, then permitted deals.
 * Returns null when the principal has no active membership in the organization.
 */
export async function resolvePrincipal(
  prisma: PrismaClient,
  claims: PrincipalClaims,
): Promise<TenantContext | null> {
  return prisma.$transaction(async (tx) => {
    await applySettings(tx, { 'app.auth_subject': claims.subject });
    const user = await tx.user.findUnique({ where: { auth0Subject: claims.subject }, select: { id: true } });
    if (!user) return null;

    await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
    const membership = await tx.organizationMembership.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
        organization: { auth0OrganizationId: claims.externalOrganizationId },
      },
      select: { organizationId: true, role: true },
    });
    if (!membership) return null;

    await tx.$executeRaw`SELECT set_config('app.organization_id', ${membership.organizationId}, true)`;
    const dealMemberships = await tx.dealMembership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { dealId: true },
      orderBy: { dealId: 'asc' },
    });

    return {
      organizationId: membership.organizationId as OrganizationId,
      userId: user.id as UserId,
      organizationRole: membership.role as OrganizationRole,
      dealIds: dealMemberships.map((row) => row.dealId as DealId),
    };
  });
}

/**
 * Background jobs re-establish tenant context from the job envelope and
 * re-check that the requester still holds an active membership on the deal.
 */
export async function resolveJobContext(
  prisma: PrismaClient,
  job: { organizationId: string; dealId: string; requestedBy: string },
): Promise<TenantContext> {
  assertUuids([job.organizationId, job.dealId, job.requestedBy]);
  const context = await prisma.$transaction(async (tx) => {
    await applySettings(tx, { 'app.organization_id': job.organizationId, 'app.user_id': job.requestedBy });
    const [orgMembership, dealMembership] = await Promise.all([
      tx.organizationMembership.findFirst({
        where: { organizationId: job.organizationId, userId: job.requestedBy, status: 'ACTIVE' },
        select: { role: true },
      }),
      tx.dealMembership.findFirst({
        where: { organizationId: job.organizationId, dealId: job.dealId, userId: job.requestedBy, status: 'ACTIVE' },
        select: { dealId: true },
      }),
    ]);
    if (!orgMembership || !dealMembership) return null;
    return {
      organizationId: job.organizationId as OrganizationId,
      userId: job.requestedBy as UserId,
      organizationRole: orgMembership.role as OrganizationRole,
      dealIds: [job.dealId as DealId],
    } satisfies TenantContext;
  });
  if (!context) throw new TenantAccessDeniedError('Job requester has no access to this deal');
  return context;
}

/**
 * Fail closed at startup if the runtime role could bypass RLS or the login
 * role cannot assume it.
 */
export async function assertRuntimeRoleIsolation(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; is_member: boolean }[]>`
    SELECT r.rolsuper, r.rolbypassrls, pg_has_role(current_user, r.oid, 'MEMBER') AS is_member
      FROM pg_roles r WHERE r.rolname = ${APP_DB_ROLE}`;
  const role = rows[0];
  if (!role) throw new Error(`Database role ${APP_DB_ROLE} is missing; run migrations`);
  if (role.rolsuper || role.rolbypassrls) throw new Error(`Database role ${APP_DB_ROLE} can bypass RLS`);
  if (!role.is_member) throw new Error(`Login role cannot assume ${APP_DB_ROLE}`);
}
