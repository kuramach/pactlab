import { createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { D, parseDecimal } from '@pactlab/calculations';
import { BILLING_TEMPLATES, type BillingTemplate } from '@pactlab/connectors';
import {
  MAX_UPLOAD_BYTES,
  type BillingSystemView,
  type ImportMappingBody,
  type ImportPreviewView,
  type ImportResultView,
  type ImportTargetView,
  type SourceUploadView,
  type UploadDetailView,
  type UploadQuery,
} from '@pactlab/contracts';
import {
  appendAuditEvent,
  BILLING_UPLOAD_PROVIDER,
  PACK_UPLOAD_PROVIDER,
  executeSyncRun,
  IdempotencyConflictError,
  sourceUploads,
  syncRuns,
  withTenant,
  type PrismaClient,
  type SourceUploadRecord,
  type TransactionClient,
} from '@pactlab/db';
import {
  applyMapping,
  canonicalMappingJson,
  CsvParseError,
  detectDateFormat,
  isBuyerSideRole,
  IMPORT_TARGET_DEFINITIONS,
  mappedEvidence,
  mappingProblems,
  MAPPING_VERSION,
  newId,
  packFor,
  parseCsv,
  peopleColumnProblems,
  permissionsForDealRole,
  suggestFields,
  targetTemplateCsv,
  type CompanyType,
  type CsvTable,
  type DealRole,
  type ImportMapping,
  type ImportTarget,
  type TargetDefinition,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import type { MalwareScanner } from '../documents/upload-policy';
import { PRISMA } from '../tokens';
import { UPLOAD_MALWARE_SCANNER, UPLOAD_OBJECT_STORE, type UploadObjectStore } from './upload-store';

/** Uploads come from the deal team or from the seller's own contributors. */
const canSupply = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') || role === 'TARGET_CONTRIBUTOR';
const canRead = (role: DealRole) => permissionsForDealRole(role).has('DEAL_READ') || role === 'TARGET_CONTRIBUTOR';

export const UPLOAD_CONNECTOR_VERSION = `billing-upload-1+${MAPPING_VERSION}`;
const MAX_ROWS = 200_000;
const SAMPLE_ROWS = 10;

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const definitionOf = (target: ImportTarget): TargetDefinition => IMPORT_TARGET_DEFINITIONS[target];
const isBilling = (target: ImportTarget) => target === 'BILLING_INVOICE_LINE';

/** Problems that stop a mapping before any row is read: refused people columns (rule 7), then the mapping itself. */
function blockingProblems(definition: TargetDefinition, header: readonly string[], mapping: ImportMapping): string[] {
  return [
    ...peopleColumnProblems(definition, header),
    ...(mapping.target === definition.target ? [] : [`This file is imported as ${definition.label}, not ${mapping.target}`]),
    ...mappingProblems(definition, header, mapping),
  ];
}

export function targetView(definition: TargetDefinition): ImportTargetView {
  return {
    target: definition.target,
    label: definition.label,
    people: definition.people,
    fields: definition.fields.map((field) => ({ name: field.name, label: field.label, required: field.required, hint: field.hint })),
    templateCsv: targetTemplateCsv(definition),
  };
}

function toView(row: SourceUploadRecord): SourceUploadView {
  return {
    id: row.id,
    target: row.target,
    system: row.system,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    rowCount: row.rowCount,
    status: row.status,
    visibility: row.visibility,
    syncRunId: row.syncRunId,
    createdAt: row.createdAt.toISOString(),
    importedAt: row.importedAt?.toISOString() ?? null,
  };
}

function systemView(template: BillingTemplate): BillingSystemView {
  return { system: template.system, label: template.label, verified: template.verified, exportHint: template.exportHint };
}

function templateFor(system: string): BillingTemplate {
  return BILLING_TEMPLATES[system as keyof typeof BILLING_TEMPLATES] ?? BILLING_TEMPLATES.other;
}

/** A first guess at the mapping; the user confirms every field before import. */
function suggestMapping(table: CsvTable, template: BillingTemplate, definition: TargetDefinition): ImportMapping {
  // Pack extracts use their standard template: columns named like the fields.
  const aliases = isBilling(definition.target) ? template.aliases : {};
  const fields = suggestFields(definition, table.header, aliases);
  const dateColumn = (isBilling(definition.target) ? ['created', 'period_start', 'period_end'] : definition.fields.filter((field) => field.kind === 'date').map((field) => field.name))
    .map((name) => fields[name])
    .find((source) => source?.kind === 'column');
  const detected = dateColumn?.kind === 'column' ? detectDateFormat(table, dateColumn.column) : null;
  return {
    target: definition.target,
    fields,
    dateFormat: detected ?? template.defaults.dateFormat ?? 'YYYY-MM-DD',
    numberFormat: template.defaults.numberFormat ?? 'DOT_DECIMAL',
    amountUnit: template.defaults.amountUnit ?? 'MAJOR',
    negateAmounts: false,
  };
}

/**
 * Billing CSV import: upload → preview a mapping → import through the
 * idempotent sync engine. Only billing exports are accepted (ADR 0004).
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(UPLOAD_OBJECT_STORE) private readonly store: UploadObjectStore,
    @Inject(UPLOAD_MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  systems(): BillingSystemView[] {
    return Object.values(BILLING_TEMPLATES).map(systemView);
  }

  /** The CSV import targets the deal's pack offers (ADR 0010); billing first. */
  async importTargets(tenant: TenantContext, dealId: string, requestId: string): Promise<ImportTargetView[]> {
    await this.access.require(tenant, dealId, canRead, { action: 'source_upload.targets', requestId });
    const companyType = await withTenant(this.prisma, tenant, (tx) => this.sellerType(tx, dealId));
    return packFor(companyType).importTargets.map((target) => targetView(definitionOf(target)));
  }

  private async sellerType(tx: TransactionClient, dealId: string): Promise<CompanyType | null> {
    const seller = await tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } });
    return seller?.companyType ?? null;
  }

  async upload(
    tenant: TenantContext,
    dealId: string,
    query: UploadQuery,
    body: unknown,
    requestId: string,
  ): Promise<UploadDetailView> {
    const role = await this.access.require(tenant, dealId, canSupply, { action: 'source_upload.created', requestId });
    if (!(body instanceof Uint8Array)) throw new UnsupportedMediaTypeException();
    if (body.byteLength === 0) throw new UnprocessableEntityException();
    if (body.byteLength > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException();
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      throw new UnsupportedMediaTypeException();
    }
    let verdict;
    try {
      verdict = await this.scanner.scan(body);
    } catch {
      verdict = 'UNAVAILABLE' as const;
    }
    if (verdict === 'UNAVAILABLE') throw new ServiceUnavailableException();
    if (verdict !== 'CLEAN') throw new UnprocessableEntityException();
    let table: CsvTable;
    try {
      table = parseCsv(text);
    } catch (error) {
      if (error instanceof CsvParseError) throw new UnprocessableEntityException();
      throw error;
    }
    if (table.rows.length > MAX_ROWS) throw new PayloadTooLargeException();

    const id = newId();
    const digest = sha256(body);
    const objectKey = `${tenant.organizationId}/${dealId}/uploads/${id}/original`;
    try {
      await this.store.put(objectKey, body, { contentType: 'text/csv', sha256: digest });
    } catch {
      throw new ServiceUnavailableException();
    }
    const row = await withTenant(this.prisma, tenant, async (tx) => {
      // A file is imported only as a target the deal's pack offers.
      if (!packFor(await this.sellerType(tx, dealId)).importTargets.includes(query.target)) throw new UnprocessableEntityException();
      const created = await sourceUploads.create(tx, {
        id,
        organizationId: tenant.organizationId,
        dealId,
        target: query.target,
        system: query.system,
        fileName: query.fileName,
        sha256: digest,
        sizeBytes: body.byteLength,
        rowCount: table.rows.length,
        header: [...table.header],
        objectKey,
        visibility: isBuyerSideRole(role) ? 'BUYER_ONLY' : 'SHARED',
        uploadedBy: tenant.userId,
      });
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: 'source_upload.created',
        targetType: 'source_upload',
        targetId: id,
        outcome: 'SUCCEEDED',
        requestId,
      });
      return created;
    });
    return this.detail(row, table);
  }

  async get(tenant: TenantContext, dealId: string, uploadId: string, requestId: string): Promise<UploadDetailView> {
    const row = await this.load(tenant, dealId, uploadId, canRead, 'source_upload.read', requestId);
    return this.detail(row, await this.table(row));
  }

  async list(tenant: TenantContext, dealId: string, requestId: string): Promise<SourceUploadView[]> {
    await this.access.require(tenant, dealId, canRead, { action: 'source_upload.list', requestId });
    return (await withTenant(this.prisma, tenant, (tx) => sourceUploads.list(tx, dealId))).map(toView);
  }

  /** Dry run: what the mapping would import. Writes nothing. */
  async preview(
    tenant: TenantContext,
    dealId: string,
    uploadId: string,
    mapping: ImportMappingBody,
    requestId: string,
  ): Promise<ImportPreviewView> {
    const row = await this.load(tenant, dealId, uploadId, canSupply, 'source_upload.previewed', requestId);
    const table = await this.table(row);
    const definition = definitionOf(row.target);
    const problems = blockingProblems(definition, table.header, mapping as ImportMapping);
    const result = problems.length > 0 ? { rows: [], issues: [] } : applyMapping(table, mapping as ImportMapping, this.dataset(row), definition);
    const grouped = new Map<string, { code: string; count: number; rows: number[]; detail: string }>();
    for (const issue of problems.length > 0 ? [] : result.issues) {
      const entry = grouped.get(issue.code) ?? { code: issue.code, count: 0, rows: [], detail: issue.detail };
      entry.count += 1;
      if (issue.row !== null && entry.rows.length < 5) entry.rows.push(issue.row);
      grouped.set(issue.code, entry);
    }
    const totals = new Map<string, { amount: NonNullable<ReturnType<typeof parseDecimal>>; lines: number }>();
    for (const { canonical } of result.rows) {
      const amount = parseDecimal(canonical['amount']);
      const currency = canonical['currency'];
      if (!amount || !currency) continue;
      const entry = totals.get(currency) ?? { amount: new D(0), lines: 0 };
      totals.set(currency, { amount: entry.amount.plus(amount), lines: entry.lines + 1 });
    }
    const emptyFields = definition.fields
      .map((field) => ({ field: field.name, rows: result.rows.filter((mapped) => mapped.canonical[field.name] === null).length }))
      .filter((entry) => entry.rows > 0);
    return {
      problems,
      rowCount: table.rows.length,
      validRows: result.rows.length,
      issues: [...grouped.values()],
      sample: result.rows.slice(0, SAMPLE_ROWS).map((mapped) => ({ ...mapped.canonical })),
      totals: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, entry]) => ({ currency, amount: entry.amount.toFixed(), lines: entry.lines })),
      emptyFields,
    };
  }

  /**
   * Import through the sync engine. The same file and mapping always resolve
   * to the same run; records already imported from an earlier export are
   * recognised as unchanged.
   */
  async import(
    tenant: TenantContext,
    dealId: string,
    uploadId: string,
    mapping: ImportMappingBody,
    requestId: string,
  ): Promise<ImportResultView> {
    const row = await this.load(tenant, dealId, uploadId, canSupply, 'source_upload.imported', requestId);
    const table = await this.table(row);
    const definition = definitionOf(row.target);
    if (blockingProblems(definition, table.header, mapping as ImportMapping).length > 0) throw new UnprocessableEntityException();
    const mappingJson = canonicalMappingJson(mapping as ImportMapping);
    const template = templateFor(row.system);

    let requested;
    try {
      requested = await withTenant(this.prisma, tenant, async (tx) => {
        if (row.status === 'IMPORTED' && row.mappingVersion !== null) {
          const previous = canonicalMappingJson(row.mapping as unknown as ImportMapping);
          if (previous !== mappingJson) throw new ConflictException();
        }
        const connection = await sourceUploads.connectionFor(tx, {
          organizationId: tenant.organizationId,
          dealId,
          system: row.system,
          systemLabel: isBilling(row.target) ? template.label : definition.label,
          target: row.target,
          visibility: row.visibility,
          createdBy: tenant.userId,
        });
        const result = await syncRuns.request(tx, {
          organizationId: tenant.organizationId,
          dealId,
          connectionId: connection.id,
          connectorVersion: UPLOAD_CONNECTOR_VERSION,
          idempotencyKey: `upload:${connection.id}:${row.sha256}:${sha256(mappingJson)}`,
          requestedBy: tenant.userId,
          correlationId: requestId,
        });
        return { connectionId: connection.id, ...result };
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) throw new ConflictException();
      throw error;
    }

    if (!requested.replayed) {
      const dataset = this.dataset(row);
      try {
        await executeSyncRun(
          this.prisma,
          { organizationId: tenant.organizationId, dealId, requestedBy: tenant.userId, syncRunId: requested.run.id },
          {
            provider: isBilling(row.target) ? BILLING_UPLOAD_PROVIDER : PACK_UPLOAD_PROVIDER,
            version: UPLOAD_CONNECTOR_VERSION,
            pull: async () =>
              mappedEvidence(
                applyMapping(table, mapping as ImportMapping, dataset, definition),
                {
                  target: row.target,
                  sourceSystem: isBilling(row.target) ? `${BILLING_UPLOAD_PROVIDER}:${row.system}` : `${PACK_UPLOAD_PROVIDER}:${row.target.toLowerCase()}`,
                  dataset,
                },
                definition,
              ),
          },
        );
      } catch {
        // The engine records FAILED with an error class; the run reports it.
      }
    }

    const outcome = await withTenant(this.prisma, tenant, async (tx) => {
      const run = await syncRuns.get(tx, dealId, requested.run.id);
      if (!run) throw new NotFoundException();
      if (run.status === 'SUCCEEDED' && row.status !== 'IMPORTED') {
        await sourceUploads.markImported(tx, row.id, {
          connectionId: requested.connectionId,
          syncRunId: run.id,
          mapping: JSON.parse(mappingJson) as object,
          mappingVersion: MAPPING_VERSION,
        });
      }
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: 'source_upload.imported',
        targetType: 'source_upload',
        targetId: row.id,
        outcome: run.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
        requestId,
      });
      return { run, upload: await sourceUploads.get(tx, dealId, row.id) };
    });
    return {
      upload: toView(outcome.upload ?? row),
      syncRun: {
        id: outcome.run.id,
        status: outcome.run.status,
        recordsSeen: outcome.run.recordsSeen,
        recordsCreated: outcome.run.recordsCreated,
        recordsUnchanged: outcome.run.recordsUnchanged,
        issuesCount: outcome.run.issuesCount,
      },
      replayed: requested.replayed,
    };
  }

  private async load(
    tenant: TenantContext,
    dealId: string,
    uploadId: string,
    rule: (role: DealRole) => boolean,
    action: string,
    requestId: string,
  ): Promise<SourceUploadRecord> {
    await this.access.require(tenant, dealId, rule, { action, requestId });
    const row = await withTenant(this.prisma, tenant, (tx) => sourceUploads.get(tx, dealId, uploadId));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async table(row: SourceUploadRecord): Promise<CsvTable> {
    if (!row.objectKey) throw new ConflictException();
    let bytes: Uint8Array;
    try {
      bytes = await this.store.get(row.objectKey);
    } catch {
      throw new ServiceUnavailableException();
    }
    // The stored original must still be the file that was uploaded.
    if (sha256(bytes) !== row.sha256) throw new ConflictException();
    return parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }

  private dataset(row: SourceUploadRecord): string {
    return `uploads/${row.id}/${row.fileName}`;
  }

  private detail(row: SourceUploadRecord, table: CsvTable): UploadDetailView {
    const template = templateFor(row.system);
    return {
      ...toView(row),
      header: [...table.header],
      sample: table.rows.slice(0, SAMPLE_ROWS).map((source) => [...source.cells]),
      suggestedMapping: suggestMapping(table, template, definitionOf(row.target)) as ImportMappingBody,
      template: systemView(template),
    };
  }
}
