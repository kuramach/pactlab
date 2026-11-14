import { D, financingPosture, needsDocument, type EscrowStatus, type TrancheKind, type TrancheStatus } from '@pactlab/calculations';
import type { EscrowStatusView, FinancingPlanView, FinancingView } from '@pactlab/contracts';
import type { TransactionClient } from '@pactlab/db';

/**
 * Reading buyer financing (T-117, ADR 0033), shared by the financing endpoints, the close checklist,
 * the investment committee and reports. Row-level security decides which plans and documents a reader
 * gets; `reader` decides what of them is shown: the seller never sees buyer notes or unshared documents.
 */
export type Reader = 'BUYER' | 'SELLER';

const today = () => new Date().toISOString().slice(0, 10);
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

/** The price a plan must cover: the bid's latest offer (seller-led), else the agreed, else the latest proposed headline price. */
async function priceFor(tx: TransactionClient, dealId: string, bidId: string | null) {
  if (bidId) {
    const offer = await tx.bidOffer.findFirst({ where: { dealId, bidId }, orderBy: { version: 'desc' }, select: { price: true, currency: true } });
    return offer ? { amount: new D(offer.price.toString()).toFixed(2), currency: offer.currency, agreed: false } : null;
  }
  const batch =
    (await tx.termProposalBatch.findFirst({ where: { dealId, agreedAt: { not: null }, declinedAt: null }, orderBy: { version: 'desc' }, include: { terms: true } })) ??
    (await tx.termProposalBatch.findFirst({ where: { dealId, proposedAt: { not: null } }, orderBy: { version: 'desc' }, include: { terms: true } }));
  const price = batch?.terms.find((term) => term.lever === 'PURCHASE_PRICE');
  return price ? { amount: price.amount.toFixed(2), currency: price.currency, agreed: Boolean(batch?.agreedAt) } : null;
}

type PlanRow = NonNullable<Awaited<ReturnType<typeof loadRows>>>[number];
function loadRows(tx: TransactionClient, dealId: string, where: { bidId?: string | null } = {}) {
  return tx.financingPlan.findMany({
    where: { dealId, ...(where.bidId !== undefined ? { bidId: where.bidId } : {}) },
    include: { tranches: { orderBy: { ordinal: 'asc' } }, escrow: true, documents: { orderBy: { uploadedAt: 'asc' } } },
    orderBy: { updatedAt: 'asc' },
  });
}

async function toView(tx: TransactionClient, row: PlanRow | null, reader: Reader, context: { dealId: string; bidId: string | null; firmName: string | null }): Promise<FinancingPlanView> {
  // The seller sees shared documents only (row-level security returns only those, too).
  const documents = (row?.documents ?? []).filter((document) => reader === 'BUYER' || document.sharedAt);
  const tranches = (row?.tranches ?? []).map((tranche) => {
    const documented = documents.some((document) => document.trancheId === tranche.id);
    return {
      id: tranche.id,
      kind: tranche.kind as TrancheKind,
      amount: tranche.amount.toFixed(2),
      currency: tranche.currency,
      status: tranche.status as TrancheStatus,
      label: tranche.label,
      buyerNote: reader === 'BUYER' ? tranche.buyerNote : null,
      needsDocument: needsDocument(tranche.status as TrancheStatus),
      documented,
    };
  });
  const escrow = row?.escrow ?? null;
  const price = await priceFor(tx, context.dealId, context.bidId);
  const posture = financingPosture({
    tranches,
    escrow: escrow
      ? { amount: escrow.amount.toFixed(2), currency: escrow.currency, status: escrow.status as EscrowStatus, depositDueOn: day(escrow.depositDueOn), hardOn: day(escrow.hardOn), confirmed: Boolean(escrow.confirmedAt) }
      : null,
    commitmentExpectedBy: day(row?.commitmentExpectedBy ?? null),
    price,
    today: today(),
  });
  return {
    id: row?.id ?? null,
    bidId: context.bidId,
    firmName: context.firmName,
    commitmentExpectedBy: day(row?.commitmentExpectedBy ?? null),
    buyerNote: reader === 'BUYER' ? (row?.buyerNote ?? '') : null,
    tranches,
    escrow: escrow
      ? {
          amount: escrow.amount.toFixed(2),
          currency: escrow.currency,
          holderKind: escrow.holderKind as 'TITLE_COMPANY' | 'ATTORNEY' | 'BROKER' | 'OTHER',
          holderName: escrow.holderName,
          depositDueOn: day(escrow.depositDueOn),
          hardOn: day(escrow.hardOn),
          refundConditions: escrow.refundConditions,
          status: escrow.status as EscrowStatusView,
          deposit: escrow.depositedOn ? { on: day(escrow.depositedOn) as string, reference: escrow.depositReference ?? '', proofDocumentId: documents.some((document) => document.id === escrow.proofDocumentId) ? escrow.proofDocumentId : null } : null,
          confirmed: Boolean(escrow.confirmedAt),
          dispute: escrow.disputedAt ? { note: escrow.disputeNote ?? '', at: escrow.disputedAt.toISOString() } : null,
        }
      : null,
    documents: documents.map((document) => ({
      id: document.id,
      purpose: document.purpose as FinancingPlanView['documents'][number]['purpose'],
      fileName: document.fileName,
      trancheId: document.trancheId,
      uploadedAt: document.uploadedAt.toISOString(),
      shared: Boolean(document.sharedAt),
    })),
    posture: { ...posture, coverage: { ...posture.coverage, otherCurrencies: [...posture.coverage.otherCurrencies] }, blockers: [...posture.blockers] },
  };
}

/**
 * The plans a reader sees on a pact. The buyer: their own (empty when not started). The seller: on a
 * buyer-led pact the buyer's; on a seller-led one every bid's, by firm.
 */
export async function financingPlans(tx: TransactionClient, dealId: string, reader: Reader, bidId: string | null): Promise<FinancingPlanView[]> {
  const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { initiatedBy: true } });
  if (!deal) return [];
  if (reader === 'BUYER' || deal.initiatedBy === 'BUYER') {
    const target = reader === 'BUYER' ? bidId : null;
    const [row] = await loadRows(tx, dealId, { bidId: target });
    const firm = target ? await tx.bid.findUnique({ where: { id: target }, select: { firmName: true } }) : null;
    return [await toView(tx, row ?? null, reader, { dealId, bidId: target, firmName: firm?.firmName ?? null })];
  }
  // A seller-led pact, read by the seller: one plan per bid, including bids with none yet.
  const [rows, bids] = await Promise.all([loadRows(tx, dealId), tx.bid.findMany({ where: { dealId }, orderBy: { createdAt: 'asc' }, select: { id: true, firmName: true, status: true } })]);
  return Promise.all(bids.filter((bid) => bid.status !== 'DECLINED').map((bid) => toView(tx, rows.find((row) => row.bidId === bid.id) ?? null, 'SELLER', { dealId, bidId: bid.id, firmName: bid.firmName })));
}

/** The buyer of the pact whose financing gates its close: the buyer-led plan, or the winning bid's. */
export async function closingFinancing(tx: TransactionClient, dealId: string, reader: Reader): Promise<FinancingPlanView | null> {
  const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { initiatedBy: true } });
  if (!deal) return null;
  if (deal.initiatedBy === 'BUYER') return (await financingPlans(tx, dealId, reader, null))[0] ?? null;
  const won = await tx.bid.findFirst({ where: { dealId, status: 'WON' }, select: { id: true } });
  if (!won) return null;
  return (await financingPlans(tx, dealId, reader === 'SELLER' ? 'SELLER' : 'BUYER', won.id)).find((plan) => plan.bidId === won.id) ?? null;
}

export type { FinancingView };
