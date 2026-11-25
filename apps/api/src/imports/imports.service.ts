import { createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { GatewayPolicyError, mapImport, type AiRunRecord, type ClaudeGateway } from '@pactlab/ai';
import { D, parseDecimal } from '@pactlab/calculations';
import { BILLING_TEMPLATES, readTable, TableReadError, type BillingTemplate, type ReadTable } from '@pactlab/connectors';
import {
  MAX_UPLOAD_BYTES,
  type BillingSystemView,
  type ImportMappingBody,
  type ImportPreviewView,
  type ImportProgressView,
  type ImportResultView,
  type ImportTargetView,
  type SourceUploadView,
  type UploadDetailView,
  type UploadQuery,
  type Page,
} from '@pactlab/contracts';
import {
  appendAuditEvent,
  BACKGROUND_IMPORT_ROWS,
  IdempotencyConflictError,
  runUploadImport,
  sourceUploads,
  syncRuns,
  UPLOAD_CONNECTOR_VERSION,
  uploadDataset,
  withTenant,
  type Prisma,
  type PrismaClient,
  type SourceUploadRecord,
  type TransactionClient,
} from '@pactlab/db';
import {
  applyMapping,
  canonicalMappingJson,
  checkProposal,
  EMPTY_GUIDANCE,
  layoutProblems,
  normalizeGuidance,
  renderGuidance,
  type ImportGuidance,
  CORE_IMPORT_TARGETS,
  namesOnly,
  reshapeTable,
  statementCheck,
  type AssistedMapping,
  detectDateFormat,
  isBuyerSideRole,
  IMPORT_TARGET_DEFINITIONS,
  mappingProblems,
  newId,
  packFor,
  regulatoryProfile,
  REGULATORY_TARGETS,
  peopleColumnProblems,
  permissionsForDealRole,
  suggestFields,
  targetTemplateCsv,
  type CompanyType,
  type CsvTable,
  type DealRole,
  type FieldSource,
  type ImportMapping,
  type ImportTarget,
  type PackDefinition,
  type TargetDefinition,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { CLAUDE_GATEWAY, DOCUMENT_OBJECT_STORE, type DocumentObjectStore } from '../documents/documents.repository';
import { FindingsService } from '../findings/findings.service';
import type { MalwareScanner } from '../documents/upload-policy';
import { PRISMA } from '../tokens';
import { IMPORT_QUEUE, UPLOAD_MALWARE_SCANNER, UPLOAD_OBJECT_STORE, type ImportQueue, type UploadObjectStore } from './upload-store';

/** Uploads come from the deal team or from the seller's own contributors. */
const canSupply = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') || role === 'TARGET_CONTRIBUTOR';
const canRead = (role: DealRole) => permissionsForDealRole(role).has('DEAL_READ') || role === 'TARGET_CONTRIBUTOR';

export { UPLOAD_CONNECTOR_VERSION };
const MAX_ROWS = 200_000;
const SAMPLE_ROWS = 10;
/** Rows the mapping screen gets: enough for a T-12's or a P&L's row labels. */
const DETAIL_ROWS = 40;

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const definitionOf = (target: ImportTarget): TargetDefinition => IMPORT_TARGET_DEFINITIONS[target];
const isBilling = (target: ImportTarget) => target === 'BILLING_INVOICE_LINE';

/**
 * Problems that stop a mapping: refused people columns (rule 7), the mapping itself, and for a
 * statement, accounts with no kind and (unless a person accepted them) subtotals that do not tie out.
 */
function blockingProblems(definition: TargetDefinition, table: CsvTable, mapping: ImportMapping): string[] {
  const problems = [
    ...peopleColumnProblems(definition, table.header),
    ...(mapping.target === definition.target ? [] : [`This file is imported as ${definition.label}, not ${mapping.target}`]),
    ...mappingProblems(definition, table.header, mapping, table.rows),
  ];
  if (problems.length > 0 || !definition.lineItems) return problems;
  const { unclassified, gaps } = statementCheck(table, mapping, definition);
  return [
    ...(unclassified.length > 0 ? [`Say what ${unclassified.length === 1 ? 'this line is' : 'these lines are'}: ${unclassified.slice(0, 5).map((account) => `"${account}"`).join(', ')}${unclassified.length > 5 ? ` and ${unclassified.length - 5} more` : ''}`] : []),
    ...(gaps.length > 0 && !mapping.acceptTieOutGaps ? [`${gaps.length === 1 ? 'A subtotal does' : `${gaps.length} subtotals do`} not add up to its lines: check the line kinds, or accept the gaps`] : []),
  ];
}

function guidanceView(guidance: ImportGuidance | null): UploadDetailView['guidance'] {
  return guidance ? { instructions: guidance.instructions, annotations: guidance.annotations.map((entry) => ({ ...entry })) } : null;
}

/** The mapping screen's view of the assistant's proposal: what it filled in and why, and what it asks. */
function assistView(assist: AssistedMapping | null): UploadDetailView['assist'] {
  if (!assist) return null;
  return {
    source: assist.source,
    picks: Object.fromEntries(Object.entries(assist.picks).map(([field, pick]) => [field, { by: pick.by, confidence: pick.confidence, reason: pick.reason }])),
    questions: assist.questions.map((question) => ({ field: question.field, question: question.question, options: [...question.options] })),
    unsureLines: [...assist.unsureLines],
    note: assist.note,
    guidance: guidanceView(assist.guidance ?? null),
  };
}

export function targetView(definition: TargetDefinition): ImportTargetView {
  return {
    target: definition.target,
    label: definition.label,
    fileName: definition.fileName,
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
function suggestMapping(table: CsvTable, template: BillingTemplate, definition: TargetDefinition, delimiter: ReadTable['delimiter'] = ','): ImportMapping {
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
    // Semicolon-separated exports come from locales that write 1.234,56.
    numberFormat: template.defaults.numberFormat ?? (delimiter === ';' ? 'COMMA_DECIMAL' : 'DOT_DECIMAL'),
    amountUnit: template.defaults.amountUnit ?? 'MAJOR',
    negateAmounts: false,
  };
}

/** The mapping the screen starts from: the assistant's checked proposal over the name match, when there is one. */
function suggestedFrom(table: CsvTable, template: BillingTemplate, definition: TargetDefinition, delimiter: ReadTable['delimiter'], assist: AssistedMapping | null): ImportMapping {
  const base = suggestMapping(table, template, definition, delimiter);
  if (!assist) return base;
  const shaped = layoutProblems(definition, table.header, assist.layout).length === 0 ? reshapeTable(table, assist.layout) : table;
  const dateColumn = Object.entries(assist.fields).find(([name, source]) => source.kind === 'column' && definition.fields.find((field) => field.name === name)?.kind === 'date')?.[1];
  const detected = dateColumn?.kind === 'column' ? detectDateFormat(shaped, dateColumn.column) : null;
  return {
    ...base,
    fields: { ...assist.fields },
    ...(detected ? { dateFormat: detected } : {}),
    ...(assist.layout.kind === 'ROWS' ? {} : { layout: assist.layout }),
    ...(definition.lineItems ? { lineKinds: { ...assist.lineKinds } } : {}),
  };
}

const CONTENT_TYPES = { CSV: 'text/csv', TSV: 'text/tab-separated-values', XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

/** A file that cannot be read as a table, as a stable problem code the web app explains. */
function tableProblem(error: TableReadError): Error {
  switch (error.code) {
    case 'NOT_TEXT':
    case 'LEGACY_EXCEL':
    case 'MACROS':
      return new UnsupportedMediaTypeException({ code: error.code });
    case 'TOO_LARGE':
      return new PayloadTooLargeException({ code: error.code });
    default:
      return new UnprocessableEntityException({ code: error.code });
  }
}

/**
 * Billing CSV import: upload → preview a mapping → import through the
 * idempotent sync engine. Only billing exports are accepted (ADR 0004).
 */
/** A pack's own imports, plus the regulatory screen's footprint and package where it runs at full depth (T-091). */
function importableTargets(pack: PackDefinition): readonly ImportTarget[] {
  return [...pack.importTargets, ...CORE_IMPORT_TARGETS, ...(regulatoryProfile(pack.id).depth === 'FULL' ? REGULATORY_TARGETS : [])];
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(UPLOAD_OBJECT_STORE) private readonly store: UploadObjectStore,
    @Inject(UPLOAD_MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(IMPORT_QUEUE) private readonly queue: ImportQueue | null,
    @Optional() @Inject(FindingsService) private readonly findings: FindingsService | null,
    @Optional() @Inject(CLAUDE_GATEWAY) private readonly gateway: ClaudeGateway | null = null,
    @Optional() @Inject(DOCUMENT_OBJECT_STORE) private readonly documentStore: DocumentObjectStore | null = null,
  ) {}

  /**
   * Read a file the way it really is (Kumar, 2026-11-21): the header found below any title rows, then
   * the mapping assistant's proposal, checked against the file. A person's own header row is kept.
   * Without the assistant, or when it fails, the read stands and columns are matched by name, said so.
   */
  private async assisted(
    tenant: TenantContext,
    dealId: string,
    input: { uploadId: string; bytes: Uint8Array; fileName: string; sheet: string | null; headerRow: number | null; target: ImportTarget; system: string; guidance: ImportGuidance | null },
  ): Promise<{ read: ReadTable; assist: AssistedMapping; run: AiRunRecord | null }> {
    const result = await this.assistedRead(tenant, dealId, input);
    // The person's words are quoted back whichever way the mapping was reached; when no assistant read the file, that is said.
    const unused = input.guidance !== null && result.run === null && result.assist.source === 'NAMES';
    const note = unused ? [result.assist.note, 'Your instructions were not used.'].filter(Boolean).join(' ') : result.assist.note;
    return { ...result, assist: { ...result.assist, note, guidance: input.guidance } };
  }

  private async assistedRead(
    tenant: TenantContext,
    dealId: string,
    input: { uploadId: string; bytes: Uint8Array; fileName: string; sheet: string | null; headerRow: number | null; target: ImportTarget; system: string; guidance: ImportGuidance | null },
  ): Promise<{ read: ReadTable; assist: AssistedMapping; run: AiRunRecord | null }> {
    const definition = definitionOf(input.target);
    const readAt = async (headerRow: number | 'detect') => {
      try {
        return await readTable(input.bytes, { fileName: input.fileName, sheet: input.sheet, headerRow });
      } catch (error) {
        if (error instanceof TableReadError) throw tableProblem(error);
        throw error;
      }
    };
    let read = await readAt(input.headerRow ?? 'detect');
    const byName = (table: CsvTable) => suggestMapping(table, templateFor(input.system), definition, read.delimiter).fields as Record<string, FieldSource>;
    const fallback = (note: string) => ({ read, assist: namesOnly(definition, read.headerRow ?? 1, read.table.header, byName(read.table), note), run: null });
    // A standard file needs no assistant: every required field matched its own column.
    const named = byName(read.table);
    if (definition.fields.every((field) => !field.required || named[field.name]?.kind === 'column') && !definition.lineItems) {
      return { read, assist: namesOnly(definition, read.headerRow ?? 1, read.table.header, named, null), run: null };
    }
    // People data never reaches a model (rule 7); such a file is refused at preview anyway.
    if (peopleColumnProblems(definition, read.table.header).length > 0) return fallback('Columns were matched by name only: this file has people columns, which must be removed first.');
    // The same file filed in the pact's documents and kept away from AI stays away from the assistant too.
    const digest = sha256(input.bytes);
    const excluded = await withTenant(this.prisma, tenant, (tx) => tx.document.findFirst({ where: { dealId, sha256: digest, aiExcluded: true }, select: { id: true } }));
    if (excluded) return fallback('Columns were matched by name only: this file is kept away from AI.');
    if (!this.gateway) return fallback('Columns were matched by name only: the mapping assistant is off.');
    let outcome;
    try {
      outcome = await mapImport(this.gateway, { organizationId: tenant.organizationId, dealId, uploadId: input.uploadId, fileName: input.fileName, sheet: read.sheet, definition, preview: read.preview, guidance: renderGuidance(input.guidance) });
    } catch (error) {
      if (error instanceof GatewayPolicyError) {
        return fallback(error.code === 'NOT_CONFIGURED' ? 'Columns were matched by name only: the mapping assistant is off.' : 'Columns were matched by name only: the mapping assistant is not available for this pact.');
      }
      throw error;
    }
    if (!outcome.proposal) return { ...fallback('Columns were matched by name only: the mapping assistant did not answer. Map the rest below.'), run: outcome.run };
    const headerRow = input.headerRow ?? outcome.proposal.headerRow;
    if (headerRow !== read.headerRow) {
      try {
        read = await readAt(headerRow);
      } catch {
        // A header row past the data: keep the detected one.
      }
    }
    const layout = outcome.proposal.layout;
    const reshaped = layoutProblems(definition, read.table.header, layout).length === 0 ? reshapeTable(read.table, layout) : read.table;
    const assist = checkProposal({
      definition,
      header: reshaped.header,
      rawHeader: read.table.header,
      preview: read.preview,
      proposal: { ...outcome.proposal, headerRow: read.headerRow ?? headerRow },
      byName: byName(read.table),
      guidance: input.guidance,
    });
    return { read, assist, run: outcome.run };
  }

  /** The assistant's run (cost, audit trail), for buyer and seller uploads alike (`app_import_record_run`). */
  private async recordRun(tx: TransactionClient, dealId: string, run: AiRunRecord | null): Promise<void> {
    if (!run) return;
    await tx.$queryRaw`SELECT app_import_record_run(${dealId}::uuid, ${JSON.stringify(run)}::jsonb)`;
  }

  systems(): BillingSystemView[] {
    return Object.values(BILLING_TEMPLATES).map(systemView);
  }

  /** The CSV import targets the deal's pack offers (ADR 0010); billing first. */
  async importTargets(tenant: TenantContext, dealId: string, requestId: string): Promise<ImportTargetView[]> {
    await this.access.require(tenant, dealId, canRead, { action: 'source_upload.targets', requestId });
    const companyType = await withTenant(this.prisma, tenant, (tx) => this.sellerType(tx, dealId));
    return importableTargets(packFor(companyType)).map((target) => targetView(definitionOf(target)));
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
    let verdict;
    try {
      verdict = await this.scanner.scan(body);
    } catch {
      verdict = 'UNAVAILABLE' as const;
    }
    if (verdict === 'UNAVAILABLE') throw new ServiceUnavailableException();
    if (verdict !== 'CLEAN') throw new UnprocessableEntityException();
    return this.create(tenant, dealId, role, body, query, requestId);
  }

  /**
   * Import a spreadsheet already filed in the pact's documents (a rent roll or P&L the intake filed):
   * the stored original, checked against its hash, becomes an upload, with no second upload. It was
   * scanned when it was filed. A person the document is hidden from cannot import it (RLS).
   */
  async fromDocument(tenant: TenantContext, dealId: string, documentId: string, target: ImportTarget, requestId: string): Promise<UploadDetailView> {
    const role = await this.access.require(tenant, dealId, canSupply, { action: 'source_upload.created', requestId });
    if (!this.documentStore) throw new ServiceUnavailableException();
    const document = await withTenant(this.prisma, tenant, (tx) =>
      tx.document.findFirst({ where: { id: documentId, dealId, status: 'AVAILABLE' }, select: { fileName: true, contentType: true, objectKey: true, sha256: true } }),
    );
    if (!document) throw new NotFoundException();
    if (!(Object.values(CONTENT_TYPES) as string[]).includes(document.contentType)) throw new UnsupportedMediaTypeException({ code: 'NOT_A_TABLE' });
    let bytes: Uint8Array;
    try {
      bytes = await this.documentStore.get(document.objectKey);
    } catch {
      throw new ServiceUnavailableException();
    }
    if (sha256(bytes) !== document.sha256) throw new ConflictException();
    return this.create(tenant, dealId, role, bytes, { target, system: 'pactlab_standard', fileName: document.fileName }, requestId);
  }

  private async create(tenant: TenantContext, dealId: string, role: DealRole, body: Uint8Array, query: UploadQuery, requestId: string): Promise<UploadDetailView> {
    const id = newId();
    // Guidance given now wins; otherwise the same file's last guidance is reused (T-152), for the person to edit before the re-run.
    const earlier = query.instructions === undefined ? await withTenant(this.prisma, tenant, (tx) => sourceUploads.guidanceFor(tx, dealId, sha256(body))) : null;
    const guidance = query.instructions === undefined ? normalizeGuidance(earlier as ImportGuidance | null) : normalizeGuidance({ instructions: query.instructions });
    const { read, assist, run } = await this.assisted(tenant, dealId, { uploadId: id, bytes: body, fileName: query.fileName, sheet: null, headerRow: null, target: query.target, system: query.system, guidance });
    const table = read.table;
    if (table.rows.length > MAX_ROWS) throw new PayloadTooLargeException({ code: 'TOO_MANY_ROWS' });

    const digest = sha256(body);
    const objectKey = `${tenant.organizationId}/${dealId}/uploads/${id}/original`;
    try {
      await this.store.put(objectKey, body, { contentType: CONTENT_TYPES[read.format], sha256: digest });
    } catch {
      throw new ServiceUnavailableException();
    }
    const row = await withTenant(this.prisma, tenant, async (tx) => {
      // A file is imported only as a target the deal's pack offers.
      if (!importableTargets(packFor(await this.sellerType(tx, dealId))).includes(query.target)) throw new UnprocessableEntityException();
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
        format: read.format,
        sheet: read.sheet,
        headerRow: read.headerRow,
        assist: assist as unknown as Prisma.InputJsonValue,
        guidance: (guidance ?? EMPTY_GUIDANCE) as unknown as Prisma.InputJsonValue,
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
      await this.recordRun(tx, dealId, run);
      return created;
    });
    return this.detail(row, read);
  }

  async get(tenant: TenantContext, dealId: string, uploadId: string, requestId: string): Promise<UploadDetailView> {
    const row = await this.load(tenant, dealId, uploadId, canRead, 'source_upload.read', requestId);
    return this.detail(row, await this.stored(row));
  }

  /** A pact's uploads, newest first, a page at a time (T-126). */
  async list(tenant: TenantContext, dealId: string, request: { cursor?: string | undefined; limit: number }, requestId: string): Promise<Page<SourceUploadView>> {
    await this.access.require(tenant, dealId, canRead, { action: 'source_upload.list', requestId });
    const page = await withTenant(this.prisma, tenant, (tx) => sourceUploads.page(tx, dealId, request));
    return { ...page, items: page.items.map(toView) };
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
    const problems = blockingProblems(definition, table, mapping as ImportMapping);
    const unblocked = problems.filter((problem) => !problem.includes('not add up'));
    const result = unblocked.length > 0 ? { rows: [], issues: [] } : applyMapping(table, mapping as ImportMapping, uploadDataset(row), definition);
    const statement = definition.lineItems ? statementCheck(table, mapping as ImportMapping, definition) : { unclassified: [], gaps: [] };
    const tieOut = unblocked.length === 0 ? statement.gaps : [];
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
      tieOut: tieOut.slice(0, 50).map((gap) => ({ ...gap })),
      unclassified: statement.unclassified.slice(0, 300),
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
    if (blockingProblems(definition, table, mapping as ImportMapping).length > 0) throw new UnprocessableEntityException();
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

    const job = {
      organizationId: tenant.organizationId,
      dealId,
      requestedBy: tenant.userId,
      correlationId: requestId,
      uploadId: row.id,
      syncRunId: requested.run.id,
      connectionId: requested.connectionId,
      mapping: mapping as ImportMapping,
    };
    // A new run, or one that failed before (the store was down, say), runs now; a succeeded or in-flight one is replayed.
    const runNow = !requested.replayed || requested.run.status === 'FAILED' || (requested.run.status === 'QUEUED' && this.queue !== null);
    // Large files import on the worker; the screen follows their progress.
    const background = runNow && this.queue !== null && table.rows.length > BACKGROUND_IMPORT_ROWS;
    if (background) {
      try {
        await this.queue?.enqueue(job, table.rows.length);
      } catch {
        throw new ServiceUnavailableException({ code: 'QUEUE_UNAVAILABLE' });
      }
    } else if (!requested.replayed || requested.run.status === 'FAILED') {
      await runUploadImport(this.prisma, this.store, job, { preread: { row, table } });
    } else {
      await withTenant(this.prisma, tenant, (tx) =>
        appendAuditEvent(tx, {
          organizationId: tenant.organizationId,
          dealId,
          actorUserId: tenant.userId,
          action: 'source_upload.imported',
          targetType: 'source_upload',
          targetId: row.id,
          outcome: 'SUCCEEDED',
          requestId,
        }),
      );
    }

    // A pack extract feeds the pack's checks: run them now (drafts only; idempotent). Background
    // imports finish on the worker, so Sources offers the run when they complete.
    if (!background && !requested.replayed && !isBilling(row.target) && this.findings) {
      try {
        await this.findings.runPackRules(tenant, dealId, requestId);
      } catch {
        // Roles that cannot draft findings (a target contributor) import without running checks.
      }
    }

    const outcome = await withTenant(this.prisma, tenant, async (tx) => {
      const run = await syncRuns.get(tx, dealId, requested.run.id);
      if (!run) throw new NotFoundException();
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
      background,
    };
  }

  /** How far an import run has got (counts only), for the screen that follows a background import. */
  async progress(tenant: TenantContext, dealId: string, runId: string, requestId: string): Promise<ImportProgressView> {
    await this.access.require(tenant, dealId, canRead, { action: 'source_upload.progress', requestId });
    const run = await withTenant(this.prisma, tenant, async (tx) => {
      const found = await syncRuns.get(tx, dealId, runId);
      if (!found) throw new NotFoundException();
      return found;
    });
    // Authorized above under RLS; only then is the worker's progress for this run read.
    // handled: live progress is optional; the run's own status (and its errors) still show
    const live = run.status === 'QUEUED' || run.status === 'RUNNING' ? await this.queue?.progress({ organizationId: tenant.organizationId, dealId, syncRunId: run.id }).catch(() => null) : null;
    const done = run.status === 'SUCCEEDED' || run.status === 'FAILED';
    return {
      syncRunId: run.id,
      status: run.status as ImportProgressView['status'],
      phase: done ? 'DONE' : (live?.phase ?? 'QUEUED'),
      processed: done ? run.recordsSeen : (live?.processed ?? 0),
      total: done ? run.recordsSeen : (live?.total ?? null),
      recordsCreated: run.recordsCreated,
      recordsUnchanged: run.recordsUnchanged,
      errorClass: run.errorClass,
    };
  }

  /**
   * Read the upload again before import: another workbook sheet, or the header on another row (a person's
   * correction). The header, row count and the assistant's proposal follow.
   */
  async selectSheet(tenant: TenantContext, dealId: string, uploadId: string, choice: { sheet?: string | undefined; headerRow?: number | undefined; guidance?: ImportGuidance | undefined }, requestId: string): Promise<UploadDetailView> {
    const row = await this.load(tenant, dealId, uploadId, canSupply, choice.guidance ? 'source_upload.guidance_set' : 'source_upload.sheet_selected', requestId);
    if (row.status !== 'UPLOADED' || (choice.sheet !== undefined && row.format !== 'XLSX')) throw new ConflictException();
    const bytes = await this.storedBytes(row);
    // A new sheet is read afresh (its header found again); a header row is the person's and is kept.
    const sheet = choice.sheet ?? row.sheet;
    // New guidance reads the file afresh too: it may say where the header is.
    const headerRow = choice.headerRow ?? (choice.sheet !== undefined || choice.guidance ? null : row.headerRow);
    // New guidance replaces the stored one (an empty one clears it); a header-row correction keeps what is stored.
    const guidance = choice.guidance ? normalizeGuidance(choice.guidance) : normalizeGuidance(row.guidance as ImportGuidance | null);
    const { read, assist, run } = await this.assisted(tenant, dealId, { uploadId: row.id, bytes, fileName: row.fileName, sheet, headerRow, target: row.target, system: row.system, guidance });
    if (read.table.rows.length > MAX_ROWS) throw new PayloadTooLargeException({ code: 'TOO_MANY_ROWS' });
    const updated = await withTenant(this.prisma, tenant, async (tx) => {
      const input = { sheet: read.sheet, headerRow: read.headerRow, header: [...read.table.header], rowCount: read.table.rows.length, assist: assist as unknown as Prisma.InputJsonValue, guidance: (guidance ?? EMPTY_GUIDANCE) as unknown as Prisma.InputJsonValue };
      if (!(await sourceUploads.reread(tx, row.id, input))) throw new ConflictException();
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: choice.guidance ? 'source_upload.guidance_set' : 'source_upload.sheet_selected',
        targetType: 'source_upload',
        targetId: row.id,
        outcome: 'SUCCEEDED',
        requestId,
      });
      await this.recordRun(tx, dealId, run);
      return sourceUploads.get(tx, dealId, row.id);
    });
    return this.detail(updated ?? row, read);
  }

  /**
   * Cancel an upload that was the wrong file: nothing is imported, the stored
   * original is deleted, and the decision is audited. An imported upload
   * cannot be cancelled — its evidence stays (upload a corrected file instead).
   */
  async cancel(tenant: TenantContext, dealId: string, uploadId: string, requestId: string): Promise<SourceUploadView> {
    const row = await this.load(tenant, dealId, uploadId, canSupply, 'source_upload.cancelled', requestId);
    if (row.status === 'PURGED') return toView(row);
    if (row.status !== 'UPLOADED') throw new ConflictException();
    if (row.objectKey) {
      try {
        await this.store.delete(row.objectKey);
      } catch {
        throw new ServiceUnavailableException();
      }
    }
    const updated = await withTenant(this.prisma, tenant, async (tx) => {
      if (!(await sourceUploads.markCancelled(tx, row.id))) throw new ConflictException();
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: 'source_upload.cancelled',
        targetType: 'source_upload',
        targetId: row.id,
        outcome: 'SUCCEEDED',
        requestId,
      });
      return sourceUploads.get(tx, dealId, row.id);
    });
    return toView(updated ?? row);
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

  /** The stored original, verified against the upload's hash. */
  private async storedBytes(row: SourceUploadRecord): Promise<Uint8Array> {
    if (!row.objectKey) throw new ConflictException();
    let bytes: Uint8Array;
    try {
      bytes = await this.store.get(row.objectKey);
    } catch {
      throw new ServiceUnavailableException();
    }
    // The stored original must still be the file that was uploaded.
    if (sha256(bytes) !== row.sha256) throw new ConflictException();
    return bytes;
  }

  /** The stored original, read the way it was uploaded (its sheet and header row). */
  private async stored(row: SourceUploadRecord): Promise<ReadTable> {
    const bytes = await this.storedBytes(row);
    try {
      return await readTable(bytes, { fileName: row.fileName, sheet: row.sheet, headerRow: row.headerRow });
    } catch (error) {
      if (error instanceof TableReadError) throw tableProblem(error);
      throw error;
    }
  }

  private async table(row: SourceUploadRecord): Promise<CsvTable> {
    return (await this.stored(row)).table;
  }

  private detail(row: SourceUploadRecord, read: ReadTable): UploadDetailView {
    const template = templateFor(row.system);
    const table = read.table;
    const assist = (row.assist ?? null) as unknown as AssistedMapping | null;
    return {
      ...toView(row),
      format: read.format,
      encoding: read.encoding,
      delimiter: read.delimiter,
      sheet: read.sheet,
      sheets: [...read.sheets],
      header: [...table.header],
      headerRow: read.headerRow,
      preview: read.preview.slice(0, SAMPLE_ROWS + 10).map((cells) => [...cells]),
      sample: table.rows.slice(0, DETAIL_ROWS).map((source) => [...source.cells]),
      suggestedMapping: suggestedFrom(table, template, definitionOf(row.target), read.delimiter, assist) as ImportMappingBody,
      assist: assistView(assist),
      guidance: guidanceView(normalizeGuidance(row.guidance as ImportGuidance | null)),
      template: systemView(template),
    };
  }
}
