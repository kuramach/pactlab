import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { SessionPolicyView, SignedInDevicesView } from '@pactlab/contracts';
import { appendAuditEvent, authSessions, withTenant, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Principal } from '../auth/auth.guard';
import { PRISMA } from '../tokens';

const isOrgAdmin = (tenant: TenantContext) => tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN';

/**
 * Signed-in devices and the organization's trusted sign-in cap (T-112). Devices are the
 * person's own Pactlab sessions; an Auth0 sign-in has none to list here.
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private session(principal: Principal): string {
    if (principal.issuer !== 'PACTLAB' || !principal.sessionId) throw new UnprocessableEntityException({ code: 'SESSIONS_EMAIL_CODE_ONLY' });
    return principal.sessionId;
  }

  async devices(principal: Principal): Promise<SignedInDevicesView> {
    const devices = await authSessions.list(this.prisma, this.session(principal));
    return {
      devices: devices.map((device) => ({
        id: device.id,
        deviceLabel: device.deviceLabel,
        trusted: device.trusted,
        signedInAt: device.signedInAt.toISOString(),
        lastSeenAt: device.lastSeenAt.toISOString(),
        expiresAt: device.expiresAt.toISOString(),
        current: device.current,
      })),
    };
  }

  async signOut(principal: Principal, targetId: string): Promise<void> {
    if (!(await authSessions.revokeOwn(this.prisma, { sessionId: this.session(principal), targetId }))) throw new NotFoundException();
  }

  async signOutOthers(principal: Principal): Promise<{ signedOut: number }> {
    return { signedOut: await authSessions.revokeOthers(this.prisma, this.session(principal)) };
  }

  async policy(tenant: TenantContext): Promise<SessionPolicyView> {
    const row = await withTenant(this.prisma, tenant, (tx) => tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { trustedSessionMaxHours: true } }));
    if (!row) throw new UnauthorizedException();
    return { maxTrustedHours: row.trustedSessionMaxHours as SessionPolicyView['maxTrustedHours'], canEdit: isOrgAdmin(tenant) };
  }

  /** Owners and admins only; the organizations_admin_update policy checks the role again. Applies to live sessions at once. */
  async setPolicy(tenant: TenantContext, maxTrustedHours: SessionPolicyView['maxTrustedHours'], requestId: string): Promise<SessionPolicyView> {
    const outcome = isOrgAdmin(tenant) ? 'SUCCEEDED' : 'DENIED';
    await withTenant(this.prisma, tenant, async (tx) => {
      if (outcome === 'SUCCEEDED') {
        await tx.organization.update({ where: { id: tenant.organizationId }, data: { trustedSessionMaxHours: maxTrustedHours, updatedAt: new Date() } });
      }
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'organization.session_policy_changed',
        targetType: 'organization',
        targetId: tenant.organizationId,
        outcome,
        requestId,
      });
    });
    if (outcome === 'DENIED') throw new ForbiddenException();
    return this.policy(tenant);
  }
}
