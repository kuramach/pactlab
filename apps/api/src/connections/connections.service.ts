import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ValidationResult } from '@pactlab/connectors';
import {
  appendAuditEvent,
  connections,
  executeSyncRun,
  IdempotencyConflictError,
  syncRuns,
  withTenant,
  type ConnectionRecord,
  type PrismaClient,
  type SyncRunRecord,
  type TransactionClient,
} from '@pactlab/db';
import {
  isBuyerSideRole,
  permissionsForDealRole,
  type DealRole,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';
import { resolveAdapter } from './adapter-registry';
import type { EvidenceSample } from './adapters/evidence-sample';
import type { CreateConnectionCommand, SetModeCommand } from './connections.schemas';

export interface ConnectionView {
  id: string;
  dealId: string;
  provider: string;
  displayName: string;
  mode: 'FIXTURE' | 'LIVE';
  hasCredential: boolean;
  status: string;
  evidenceVisibility: 'BUYER_ONLY' | 'SHARED';
  createdAt: string;
  updatedAt: string;
}

/** A connection with what it last produced, for the deal's Sources view. */
export interface ConnectionSummaryView extends ConnectionView {
  lastSyncRun: {
    id: string;
    status: string;
    connectorVersion: string;
    recordsSeen: number;
    recordsCreated: number;
    issuesCount: number;
    errorClass: string | null;
    completedAt: string | null;
  } | null;
  /** Evidence items from this connection visible to the caller (RLS). */
  evidenceCount: number;
}

export interface SyncRunView {
  id: string;
  dealId: string;
  connectionId: string;
  connectorVersion: string;
  status: SyncRunRecord['status'];
  recordsSeen: number;
  recordsCreated: number;
  recordsUnchanged: number;
  issuesCount: number;
  errorClass: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function toConnectionView(row: ConnectionRecord): ConnectionView {
  // The credential reference itself is never returned.
  return {
    id: row.id,
    dealId: row.dealId,
    provider: row.provider,
    displayName: row.displayName,
    mode: row.mode,
    hasCredential: row.credentialRef !== null,
    status: row.status,
    evidenceVisibility: row.evidenceVisibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRunView(row: SyncRunRecord): SyncRunView {
  return {
    id: row.id,
    dealId: row.dealId,
    connectionId: row.connectionId,
    connectorVersion: row.connectorVersion,
    status: row.status,
    recordsSeen: row.recordsSeen,
    recordsCreated: row.recordsCreated,
    recordsUnchanged: row.recordsUnchanged,
    issuesCount: row.issuesCount,
    errorClass: row.errorClass,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/** Buyers with DEAL_WRITE manage connections; target contributors may supply their own. */
const canSupplyConnections = (role: DealRole) =>
  permissionsForDealRole(role).has('DEAL_WRITE') || role === 'TARGET_CONTRIBUTOR';

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private audit(
    tx: TransactionClient,
    tenant: TenantContext,
    dealId: string,
    action: string,
    targetId: string,
    requestId: string,
    outcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED',
  ) {
    return appendAuditEvent(tx, {
      organizationId: tenant.organizationId,
      dealId,
      actorUserId: tenant.userId,
      action,
      targetType: 'connection',
      targetId,
      outcome,
      requestId,
    });
  }

  private async load(
    tenant: TenantContext,
    dealId: string,
    connectionId: string,
  ): Promise<ConnectionRecord> {
    const connection = await withTenant(this.prisma, tenant, (tx) =>
      connections.get(tx, dealId, connectionId),
    );
    if (!connection) throw new NotFoundException();
    return connection;
  }

  /** Contributors only operate on connections whose evidence is shared with them. */
  private assertConnectionAccess(role: DealRole, connection: ConnectionRecord): void {
    if (!isBuyerSideRole(role) && connection.evidenceVisibility !== 'SHARED')
      throw new ForbiddenException();
  }

  async list(tenant: TenantContext, dealId: string, requestId: string): Promise<ConnectionSummaryView[]> {
    await this.access.require(tenant, dealId, 'DEAL_READ', {
      action: 'connection.list',
      requestId,
    });
    return withTenant(this.prisma, tenant, async (tx) => {
      const rows = await connections.list(tx, dealId);
      // Sequential: one transaction, one connection.
      const views: ConnectionSummaryView[] = [];
      for (const row of rows) {
        const run = await tx.syncRun.findFirst({
          where: { dealId, connectionId: row.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const evidenceCount = await tx.evidenceItem.count({ where: { dealId, connectionId: row.id } });
        views.push({
          ...toConnectionView(row),
          lastSyncRun: run
            ? {
                id: run.id,
                status: run.status,
                connectorVersion: run.connectorVersion,
                recordsSeen: run.recordsSeen,
                recordsCreated: run.recordsCreated,
                issuesCount: run.issuesCount,
                errorClass: run.errorClass,
                completedAt: run.completedAt?.toISOString() ?? null,
              }
            : null,
          evidenceCount,
        });
      }
      return views;
    });
  }

  async create(
    tenant: TenantContext,
    dealId: string,
    command: CreateConnectionCommand,
    requestId: string,
  ): Promise<ConnectionView> {
    const role = await this.access.require(tenant, dealId, canSupplyConnections, {
      action: 'connection.created',
      requestId,
    });
    if ((command.mode === 'LIVE') !== (command.credentialRef !== undefined))
      throw new ConflictException();
    const row = await withTenant(this.prisma, tenant, async (tx) => {
      const created = await connections.create(tx, {
        organizationId: tenant.organizationId,
        dealId,
        provider: command.provider,
        displayName: command.displayName,
        mode: command.mode,
        credentialRef: command.credentialRef ?? null,
        config: command.config,
        // Target-supplied sources are visible to the target; buyer sources stay buyer-only.
        evidenceVisibility: isBuyerSideRole(role) ? 'BUYER_ONLY' : 'SHARED',
        createdBy: tenant.userId,
      });
      await this.audit(tx, tenant, dealId, 'connection.created', created.id, requestId);
      return created;
    });
    return toConnectionView(row);
  }

  /** Persisted, audited mode switch. Only mode and credential reference change — never code or schema. */
  async setMode(
    tenant: TenantContext,
    dealId: string,
    connectionId: string,
    command: SetModeCommand,
    requestId: string,
  ): Promise<ConnectionView> {
    await this.access.require(tenant, dealId, 'DEAL_WRITE', {
      action: 'connection.mode_changed',
      requestId,
    });
    if ((command.mode === 'LIVE') !== (command.credentialRef !== undefined))
      throw new ConflictException();
    await this.load(tenant, dealId, connectionId);
    const row = await withTenant(this.prisma, tenant, async (tx) => {
      const updated = await connections.setMode(tx, connectionId, {
        mode: command.mode,
        credentialRef: command.credentialRef ?? null,
      });
      await this.audit(tx, tenant, dealId, 'connection.mode_changed', connectionId, requestId);
      return updated;
    });
    return toConnectionView(row);
  }

  async validate(
    tenant: TenantContext,
    dealId: string,
    connectionId: string,
    requestId: string,
  ): Promise<ValidationResult & { provider: string; adapterVersion: string; mode: string }> {
    const role = await this.access.require(tenant, dealId, canSupplyConnections, {
      action: 'connection.validated',
      requestId,
    });
    const connection = await this.load(tenant, dealId, connectionId);
    this.assertConnectionAccess(role, connection);
    const adapter = resolveAdapter(connection);
    if (!adapter) throw new ConflictException();
    const result = await adapter.validateConnection(this.scope(connection));
    await withTenant(this.prisma, tenant, (tx) =>
      this.audit(
        tx,
        tenant,
        dealId,
        'connection.validated',
        connectionId,
        requestId,
        result.ok ? 'SUCCEEDED' : 'FAILED',
      ),
    );
    return {
      ...result,
      provider: adapter.provider,
      adapterVersion: adapter.version,
      mode: adapter.mode,
    };
  }

  /** Bounded, read-only sample. Nothing is persisted except the audit event. */
  async dryRun(
    tenant: TenantContext,
    dealId: string,
    connectionId: string,
    limit: number,
    requestId: string,
  ): Promise<{ sample: readonly EvidenceSample[]; truncated: boolean }> {
    const role = await this.access.require(tenant, dealId, canSupplyConnections, {
      action: 'connection.dry_run',
      requestId,
    });
    const connection = await this.load(tenant, dealId, connectionId);
    this.assertConnectionAccess(role, connection);
    const adapter = resolveAdapter(connection);
    if (!adapter) throw new ConflictException();
    const result = await adapter.dryRun(this.scope(connection), { limit });
    await withTenant(this.prisma, tenant, (tx) =>
      this.audit(tx, tenant, dealId, 'connection.dry_run', connectionId, requestId),
    );
    return result;
  }

  /**
   * Request a sync run idempotently, then execute it with the replay-safe
   * engine (the same handler a queue worker runs). A replayed key returns the
   * existing run without re-executing.
   */
  async requestSync(
    tenant: TenantContext,
    dealId: string,
    connectionId: string,
    idempotencyKey: string,
    requestId: string,
  ): Promise<SyncRunView> {
    const role = await this.access.require(tenant, dealId, canSupplyConnections, {
      action: 'sync_run.requested',
      requestId,
    });
    const connection = await this.load(tenant, dealId, connectionId);
    this.assertConnectionAccess(role, connection);
    const adapter = resolveAdapter(connection);
    if (!adapter || connection.status !== 'ACTIVE') throw new ConflictException();

    let requested;
    try {
      requested = await withTenant(this.prisma, tenant, async (tx) => {
        const result = await syncRuns.request(tx, {
          organizationId: tenant.organizationId,
          dealId,
          connectionId,
          connectorVersion: adapter.version,
          idempotencyKey,
          requestedBy: tenant.userId,
          correlationId: requestId,
        });
        if (!result.replayed) {
          await appendAuditEvent(tx, {
            organizationId: tenant.organizationId,
            dealId,
            actorUserId: tenant.userId,
            action: 'sync_run.requested',
            targetType: 'sync_run',
            targetId: result.run.id,
            outcome: 'SUCCEEDED',
            requestId,
          });
        }
        return result;
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) throw new ConflictException();
      throw error;
    }

    if (!requested.replayed) {
      try {
        await executeSyncRun(
          this.prisma,
          {
            organizationId: tenant.organizationId,
            dealId,
            requestedBy: tenant.userId,
            syncRunId: requested.run.id,
          },
          await adapter.evidenceSource(this.scope(connection)),
        );
      } catch {
        // The engine records FAILED with an error class; the run resource reports it.
      }
    }
    return this.getRun(tenant, dealId, requested.run.id, requestId);
  }

  async getRun(
    tenant: TenantContext,
    dealId: string,
    runId: string,
    requestId: string,
  ): Promise<SyncRunView> {
    await this.access.require(tenant, dealId, canSupplyConnections, {
      action: 'sync_run.read',
      requestId,
    });
    const run = await withTenant(this.prisma, tenant, (tx) => syncRuns.get(tx, dealId, runId));
    if (!run) throw new NotFoundException();
    return toRunView(run);
  }

  private scope(connection: ConnectionRecord) {
    return {
      organizationId: connection.organizationId,
      dealId: connection.dealId,
      connectionId: connection.id,
      credentialRef: connection.credentialRef,
    };
  }
}
