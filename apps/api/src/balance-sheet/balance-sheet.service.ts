import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { citationStillValid, PROHIBITED_CLASSIFICATIONS, SourceIndex, type CitableSource } from '@pactlab/ai';
import { balanceSheetDate, D, proposeBalanceSheetItems } from '@pactlab/calculations';
import {
  hasLoanTerms,
  type BalanceSheetItemInput,
  type BalanceSheetItemView,
  type BalanceSheetProposalsView,
  type BalanceSheetView,
  type ReviseBalanceSheetItem,
  type WithdrawBalanceSheetItem,
} from '@pactlab/contracts';
import {
  appendAuditEvent,
  balanceSheetItems,
  withTenant,
  type BalanceSheetItemRecord,
  type ItemCitation,
  type LoanTerms,
  type PrismaClient,
  type TransactionClient,
} from '@pactlab/db';
import { permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const PROHIBITED = new Set<string>(PROHIBITED_CLASSIFICATIONS);

/**
 * Cash, debt and debt-like items: each one a person's figure backed by an
 * exact quote from a document page, verified on entry and re-checked when
 * shown. Scenarios link them; revising or withdrawing one makes linked
 * results stale. Buyer-side analysis only.
 */
/** Typed terms to stored terms: the yearly percent becomes an exact fraction ("7.5" → "0.075"). */
function termsFrom(input: Pick<BalanceSheetItemInput, 'interestRatePercent' | 'rateType' | 'rateReference' | 'maturityDate' | 'lender' | 'repayment' | 'covenantNote'>): LoanTerms {
  return {
    interestRate: input.interestRatePercent === null ? null : new D(input.interestRatePercent).dividedBy(100).toFixed(),
    rateType: input.rateType,
    rateReference: input.rateReference,
    maturityDate: input.maturityDate,
    lender: input.lender,
    repayment: input.repayment,
    covenantNote: input.covenantNote,
  };
}

@Injectable()
export class BalanceSheetService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  /** Verify a pasted quote against the stored page text; never from people data or purged documents. */
  private async verify(tx: TransactionClient, dealId: string, source: { documentId: string; pageNumber: number; quote: string }): Promise<ItemCitation> {
    const page = await tx.documentPage.findFirst({
      where: { dealId, documentId: source.documentId, pageNumber: source.pageNumber },
      select: { text: true, document: { select: { fileName: true, dataClass: true, status: true } } },
    });
    if (!page || page.text === null || page.document.status !== 'AVAILABLE') throw new UnprocessableEntityException({ code: 'PAGE_UNAVAILABLE', message: 'That document page is not available' });
    if (PROHIBITED.has(page.document.dataClass)) throw new UnprocessableEntityException({ code: 'PEOPLE_DATA', message: 'People data cannot be cited for balance-sheet items' });
    const citable: CitableSource = {
      citationId: `${source.documentId}:${source.pageNumber}`,
      documentId: source.documentId,
      documentName: page.document.fileName,
      pageNumber: source.pageNumber,
      text: page.text,
      classification: page.document.dataClass,
    };
    const check = new SourceIndex([citable]).verify({ citationId: citable.citationId, quote: source.quote });
    if (!check.ok) throw new UnprocessableEntityException({ code: check.reason, message: `Citation refused: ${check.reason}` });
    const { citationId: _id, ...citation } = check.citation;
    return citation;
  }

  /**
   * Proposals read from an uploaded balance sheet (T-094 B9): deterministic,
   * never stored, never on the bridge. A person confirms each one through
   * create(), which re-verifies the quote against the page.
   */
  async proposals(tenant: TenantContext, dealId: string, documentId: string, requestId: string): Promise<BalanceSheetProposalsView> {
    await this.access.require(tenant, dealId, canRead, { action: 'balance_sheet.proposals_read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const document = await tx.document.findFirst({
        where: { id: documentId, dealId, status: 'AVAILABLE', dataClass: { notIn: [...PROHIBITED_CLASSIFICATIONS] } },
        select: { id: true },
      });
      if (!document) throw new NotFoundException();
      const [pages, items] = await Promise.all([
        tx.documentPage.findMany({ where: { dealId, documentId }, select: { pageNumber: true, text: true }, orderBy: { pageNumber: 'asc' } }),
        balanceSheetItems.list(tx, dealId),
      ]);
      const readable = pages.filter((page): page is { pageNumber: number; text: string } => page.text !== null);
      const recorded = new Set(items.filter((item) => item.citation.documentId === documentId).map((item) => `${item.citation.pageNumber}:${item.citation.quote}`));
      const all = proposeBalanceSheetItems(readable);
      const proposals = all.filter((proposal) => !recorded.has(`${proposal.pageNumber}:${proposal.quote}`));
      return { documentId, asOf: balanceSheetDate(readable[0]?.text ?? ''), proposals, alreadyRecorded: all.length - proposals.length };
    });
  }

  async list(tenant: TenantContext, dealId: string, requestId: string): Promise<BalanceSheetView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'balance_sheet.list', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const [items, history, documents] = await Promise.all([
        balanceSheetItems.list(tx, dealId),
        balanceSheetItems.history(tx, dealId),
        tx.document.findMany({
          where: { dealId, status: 'AVAILABLE', dataClass: { notIn: [...PROHIBITED_CLASSIFICATIONS] } },
          select: { id: true, fileName: true, pageCount: true, category: true },
          orderBy: { fileName: 'asc' },
        }),
      ]);
      // Files intake has filed as balance sheets (T-098) come first, so the reader opens on one.
      documents.sort((a, b) => Number(b.category === 'BALANCE_SHEET') - Number(a.category === 'BALANCE_SHEET'));
      const pages = await tx.documentPage.findMany({
        where: { dealId, OR: items.map((item) => ({ documentId: item.citation.documentId, pageNumber: item.citation.pageNumber })) },
        select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true } } },
      });
      const users = await tx.user.findMany({
        where: { id: { in: [...new Set([...items.map((item) => item.updatedBy), ...history.map((entry) => entry.changedBy)])] } },
        select: { id: true, displayName: true },
      });
      const names = new Map(users.map((user) => [user.id, user.displayName]));
      const view = (item: BalanceSheetItemRecord): BalanceSheetItemView => {
        const page = pages.find((candidate) => candidate.documentId === item.citation.documentId && candidate.pageNumber === item.citation.pageNumber);
        return {
          id: item.id,
          kind: item.kind,
          category: item.category as BalanceSheetItemView['category'],
          label: item.label,
          amount: item.amount,
          currency: item.currency,
          asOf: item.asOf,
          citation: { documentId: item.citation.documentId, documentName: page?.document.fileName ?? null, pageNumber: item.citation.pageNumber, quote: item.citation.quote },
          citationValid: page?.text != null && citationStillValid({ citationId: '', ...item.citation }, page.text),
          note: item.note,
          terms: item.terms,
          version: item.version,
          status: item.status,
          updatedBy: item.updatedBy,
          updatedByName: names.get(item.updatedBy) ?? null,
          updatedAt: item.updatedAt.toISOString(),
          history: history
            .filter((entry) => entry.itemId === item.id)
            .map((entry) => ({
              version: entry.version,
              amount: entry.amount,
              status: entry.status,
              reason: entry.reason,
              changedByName: names.get(entry.changedBy) ?? null,
              changedAt: entry.changedAt.toISOString(),
            })),
        };
      };
      const currencies = new Set(items.map((item) => item.currency));
      const total = (kind: BalanceSheetItemRecord['kind']) =>
        items.filter((item) => item.kind === kind).reduce((sum, item) => sum.plus(item.amount), new D(0)).toFixed(2);
      return {
        items: items.map(view),
        totals: currencies.size === 1 ? { currency: [...currencies][0] as string, cash: total('CASH'), debt: total('DEBT'), debtLike: total('DEBT_LIKE') } : null,
        canEdit: canWrite(role),
        documents,
      };
    });
  }

  async create(tenant: TenantContext, dealId: string, input: BalanceSheetItemInput, requestId: string): Promise<BalanceSheetView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'balance_sheet_item.created', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const citation = await this.verify(tx, dealId, input);
      const item = await balanceSheetItems.create(tx, {
        kind: input.kind,
        category: input.category,
        label: input.label,
        amount: input.amount,
        currency: input.currency,
        asOf: input.asOf,
        citation,
        note: input.note,
        terms: termsFrom(input),
        organizationId: tenant.organizationId,
        dealId,
        createdBy: tenant.userId,
        reason: 'Recorded',
      });
      await this.audit(tx, tenant, dealId, 'balance_sheet_item.created', item.id, requestId);
    });
    return this.list(tenant, dealId, requestId);
  }

  async revise(tenant: TenantContext, dealId: string, itemId: string, input: ReviseBalanceSheetItem, requestId: string): Promise<BalanceSheetView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'balance_sheet_item.revised', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const current = await balanceSheetItems.get(tx, dealId, itemId);
      if (!current) throw new NotFoundException();
      const citation = await this.verify(tx, dealId, input);
      if (current.kind !== 'DEBT' && hasLoanTerms(input)) {
        throw new UnprocessableEntityException({ code: 'TERMS_DEBT_ONLY', message: 'Loan terms apply to debt items only' });
      }
      const revised = await balanceSheetItems.revise(tx, {
        kind: current.kind,
        terms: termsFrom(input),
        category: input.category,
        label: input.label,
        amount: input.amount,
        currency: input.currency,
        asOf: input.asOf,
        citation,
        note: input.note,
        organizationId: tenant.organizationId,
        dealId,
        id: itemId,
        expectedVersion: input.expectedVersion,
        updatedBy: tenant.userId,
        reason: input.reason,
      }).catch((error: unknown) => {
        // A category from another kind fails the database CHECK.
        if (error instanceof Error && /check constraint/i.test(error.message)) throw new UnprocessableEntityException({ code: 'CATEGORY_KIND', message: 'That category does not belong to this kind of item' });
        throw error;
      });
      if (!revised) throw new ConflictException('The item changed or was withdrawn in the meantime');
      await this.audit(tx, tenant, dealId, 'balance_sheet_item.revised', itemId, requestId);
    });
    return this.list(tenant, dealId, requestId);
  }

  async withdraw(tenant: TenantContext, dealId: string, itemId: string, input: WithdrawBalanceSheetItem, requestId: string): Promise<BalanceSheetView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'balance_sheet_item.withdrawn', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      if (!(await balanceSheetItems.get(tx, dealId, itemId))) throw new NotFoundException();
      const withdrawn = await balanceSheetItems.withdraw(tx, {
        organizationId: tenant.organizationId,
        dealId,
        id: itemId,
        expectedVersion: input.expectedVersion,
        updatedBy: tenant.userId,
        reason: input.reason,
      });
      if (!withdrawn) throw new ConflictException('The item changed or was withdrawn in the meantime');
      await this.audit(tx, tenant, dealId, 'balance_sheet_item.withdrawn', itemId, requestId);
    });
    return this.list(tenant, dealId, requestId);
  }

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, {
      organizationId: tenant.organizationId,
      dealId,
      actorUserId: tenant.userId,
      action,
      targetType: 'balance_sheet_item',
      targetId,
      outcome: 'SUCCEEDED',
      requestId,
    });
  }
}
