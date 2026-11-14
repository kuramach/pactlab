import type { FinancingPlanView, FinancingView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { Landmark } from 'lucide-react';
import { apiGet } from '../../_lib/api';
import { FinancingPosture, money, PURPOSE_LABELS, TRANCHE_KIND_LABELS, TRANCHE_STATUS_LABELS, TrancheTable } from '../../_lib/financing';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addTranche, attachDocument, confirmDeposit, disputeDeposit, recordDeposit, recordDisposition, removeTranche, saveEscrow, savePlan, shareDocument, updateTranche } from './actions';

export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-saved': 'Saved.',
  'ok-removed': 'Removed.',
  'ok-attached': 'Attached. It stays with your side until you share it.',
  'ok-shared': 'Shared with the seller.',
  'ok-unshared': 'No longer shared with the seller.',
  'ok-deposited': 'Deposit recorded. The seller confirms it.',
  'ok-confirmed': 'Deposit confirmed.',
  'ok-disputed': 'Sent back to the buyer with your note.',
  'ok-disposed': 'Recorded.',
  'error-FINANCING_PROOF_NOT_SHARED': 'Share the proof with the seller first: they confirm the deposit against it.',
  'error-FINANCING_PROOF_IN_USE': 'That document is the proof of a recorded deposit; it stays shared.',
  'error-FINANCING_ESCROW_DEPOSITED': 'The deposit is recorded; its terms no longer change.',
  'error-FINANCING_TOO_MANY_TRANCHES': 'Up to 12 sources of funds per plan.',
  'error-NO_FILE': 'Choose a PDF first.',
  'error-TOO_LARGE': 'That file is over 10 MB.',
  'error-UPLOAD_MALWARE': 'That file was refused by the malware check.',
  unsupported: 'Attach a PDF.',
  conflict: 'That step does not apply right now. Reload and try again.',
};
const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const KINDS = Object.keys(TRANCHE_KIND_LABELS) as (keyof typeof TRANCHE_KIND_LABELS)[];
const STATUSES = Object.keys(TRANCHE_STATUS_LABELS) as (keyof typeof TRANCHE_STATUS_LABELS)[];
const HOLDERS = { TITLE_COMPANY: 'Title company', ATTORNEY: 'Attorney', BROKER: 'Broker', OTHER: 'Other third party' } as const;

function TrancheFields({ values }: { values?: FinancingPlanView['tranches'][number] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-6">
      <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">
        Source
        <select name="kind" defaultValue={values?.kind ?? 'CASH'} className={field}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {TRANCHE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">
        Amount
        <input name="amount" inputMode="decimal" required defaultValue={values?.amount ?? ''} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Currency
        <input name="currency" maxLength={3} defaultValue={values?.currency ?? 'USD'} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Status
        <select name="status" defaultValue={values?.status ?? 'EXPLORING'} className={field}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {TRANCHE_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-3">
        Label the seller sees (optional)
        <input name="label" maxLength={120} defaultValue={values?.label ?? ''} className={field} placeholder="e.g. Senior term loan" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-3">
        Private note (your side only)
        <input name="buyerNote" maxLength={2000} defaultValue={values?.buyerNote ?? ''} className={field} placeholder="e.g. the lender’s name" />
      </label>
    </div>
  );
}

function Documents({ dealId, plan, side, canEdit }: { dealId: string; plan: FinancingPlanView; side: 'BUYER' | 'SELLER'; canEdit: boolean }) {
  const tranche = (id: string | null) => plan.tranches.find((entry) => entry.id === id);
  return (
    <div className="flex flex-col gap-2">
      {plan.documents.length === 0 ? <p className="text-sm text-muted-foreground">{side === 'SELLER' ? 'The buyer has shared no documents.' : 'No documents yet.'}</p> : null}
      <ul className="divide-y divide-border">
        {plan.documents.map((document) => (
          <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              <a href={`/deals/${dealId}/financing/documents/${document.id}`} className="font-medium underline underline-offset-4">
                {document.fileName}
              </a>{' '}
              <span className="text-muted-foreground">
                {PURPOSE_LABELS[document.purpose]}
                {(() => {
                  const backed = tranche(document.trancheId);
                  return backed ? ` · ${TRANCHE_KIND_LABELS[backed.kind]}` : '';
                })()}
              </span>
            </span>
            {side === 'BUYER' ? (
              <span className="flex items-center gap-2">
                <Badge variant={document.shared ? 'calculation' : 'neutral'}>{document.shared ? 'Shared with the seller' : 'Your side only'}</Badge>
                {canEdit ? (
                  <form action={shareDocument.bind(null, dealId, document.id, !document.shared)}>
                    <Button type="submit" size="sm" variant="ghost">
                      {document.shared ? 'Stop sharing' : 'Share'}
                    </Button>
                  </form>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {side === 'BUYER' && canEdit ? (
        <form action={attachDocument.bind(null, dealId)} className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-medium">
            What it is
            <select name="purpose" defaultValue="COMMITMENT_LETTER" className={field}>
              {Object.entries(PURPOSE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Backs
            <select name="trancheId" defaultValue="" className={field}>
              <option value="">The plan as a whole</option>
              {plan.tranches.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {TRANCHE_KIND_LABELS[entry.kind]} · {money(entry.amount, entry.currency)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            PDF (up to 10 MB)
            <input name="file" type="file" accept="application/pdf" required className="text-sm" />
          </label>
          <div className="flex items-end">
            <Button type="submit" size="sm" variant="outline">
              Attach
            </Button>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-4">Attached documents stay with your side. Share each one with the seller when you choose; you can stop sharing at any time.</p>
        </form>
      ) : null}
    </div>
  );
}

function Escrow({ dealId, plan, side, canEdit }: { dealId: string; plan: FinancingPlanView; side: 'BUYER' | 'SELLER'; canEdit: boolean }) {
  const escrow = plan.escrow;
  const shared = plan.documents.filter((document) => document.shared);
  const editable = side === 'BUYER' && canEdit && (!escrow || escrow.status === 'COMMITTED' || escrow.status === 'NOT_COMMITTED');
  return (
    <div className="flex flex-col gap-3 text-sm">
      {escrow ? (
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Amount</dt><dd>{money(escrow.amount, escrow.currency)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Held by</dt><dd>{escrow.holderName} ({HOLDERS[escrow.holderKind]})</dd></div>
          <div><dt className="text-xs text-muted-foreground">Deposit due</dt><dd>{escrow.depositDueOn ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Goes hard (non-refundable)</dt><dd>{escrow.hardOn ?? '—'}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Refund conditions</dt><dd>{escrow.refundConditions || '—'}</dd></div>
          {escrow.deposit ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Deposit</dt>
              <dd>
                Recorded {escrow.deposit.on}, reference {escrow.deposit.reference}
                {escrow.deposit.proofDocumentId ? (
                  <>
                    {' '}·{' '}
                    <a href={`/deals/${dealId}/financing/documents/${escrow.deposit.proofDocumentId}`} className="underline underline-offset-4">
                      proof
                    </a>
                  </>
                ) : null}{' '}
                · {escrow.confirmed ? 'confirmed by the seller' : 'awaiting the seller’s confirmation'}
              </dd>
            </div>
          ) : null}
          {escrow.dispute ? <p role="note" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-950 sm:col-span-2">The seller disputed the deposit: {escrow.dispute.note}</p> : null}
        </dl>
      ) : (
        <p className="text-muted-foreground">{side === 'SELLER' ? 'No earnest money committed.' : 'No earnest money committed yet.'}</p>
      )}

      {editable ? (
        <form action={saveEscrow.bind(null, dealId)} className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-medium">Amount<input name="amount" inputMode="decimal" required defaultValue={escrow?.amount ?? ''} className={field} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">Currency<input name="currency" maxLength={3} defaultValue={escrow?.currency ?? 'USD'} className={field} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Held by
            <select name="holderKind" defaultValue={escrow?.holderKind ?? 'TITLE_COMPANY'} className={field}>
              {Object.entries(HOLDERS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Holder’s name<input name="holderName" required defaultValue={escrow?.holderName ?? ''} className={field} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">Deposit due<input name="depositDueOn" type="date" defaultValue={escrow?.depositDueOn ?? ''} className={field} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">Goes hard on<input name="hardOn" type="date" defaultValue={escrow?.hardOn ?? ''} className={field} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">Refund conditions<input name="refundConditions" defaultValue={escrow?.refundConditions ?? ''} className={field} /></label>
          <div className="sm:col-span-4"><Button type="submit" size="sm" variant="outline">{escrow ? 'Save earnest money' : 'Commit earnest money'}</Button></div>
          <p className="text-xs text-muted-foreground sm:col-span-4">The money sits with the third party you name, never with Pactlab. Pactlab records what each side states.</p>
        </form>
      ) : null}

      {side === 'BUYER' && canEdit && escrow?.status === 'COMMITTED' ? (
        <form action={recordDeposit.bind(null, dealId)} className="grid gap-2 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-medium">Deposited on<input name="depositedOn" type="date" required className={field} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">Reference<input name="reference" required className={field} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Proof (shared documents)
            <select name="proofDocumentId" defaultValue="" className={field}>
              <option value="">None</option>
              {shared.map((document) => (<option key={document.id} value={document.id}>{document.fileName}</option>))}
            </select>
          </label>
          <div className="flex items-end"><Button type="submit" size="sm">Record the deposit</Button></div>
        </form>
      ) : null}

      {side === 'SELLER' && plan.id && escrow?.status === 'DEPOSITED' && !escrow.confirmed ? (
        <div className="flex flex-wrap items-end gap-3">
          <form action={confirmDeposit.bind(null, dealId, plan.id)}><Button type="submit" size="sm">Confirm the deposit</Button></form>
          <form action={disputeDeposit.bind(null, dealId, plan.id)} className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium">Not received? Say why<input name="note" required minLength={3} className={field} /></label>
            <Button type="submit" size="sm" variant="outline">Dispute</Button>
          </form>
        </div>
      ) : null}

      {escrow?.status === 'DEPOSITED' && escrow.confirmed && (side === 'SELLER' || canEdit) ? (
        <div className="flex flex-wrap gap-2">
          <form action={recordDisposition.bind(null, dealId, side === 'SELLER' ? plan.id : null, 'APPLIED_AT_CLOSE')}><Button type="submit" size="sm" variant="outline">Applied against the price at close</Button></form>
          {side === 'SELLER' ? (
            <form action={recordDisposition.bind(null, dealId, plan.id, 'RELEASED_TO_SELLER')}><Button type="submit" size="sm" variant="ghost">Released to us</Button></form>
          ) : (
            <form action={recordDisposition.bind(null, dealId, null, 'REFUNDED_TO_BUYER')}><Button type="submit" size="sm" variant="ghost">Refunded to us</Button></form>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Buyer financing (T-117, ADR 0033): how the buyer funds the deal. The buyer keeps the plan; the
 * seller sees structure, status, coverage and the documents the buyer shares — nothing else. On a
 * seller-led pact each bidder keeps their own, and the seller compares them.
 */
export default async function FinancingPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<{ outcome?: string }> }) {
  const { dealId } = await params;
  const { outcome } = await searchParams;
  const result = await apiGet<FinancingView>(`/v1/deals/${dealId}/financing`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const { side, canEdit, plans } = result.data;
  if (!side) return <EmptyState icon={<Landmark />} title="Financing" description="Financing is between the buyer and the seller of this pact." />;

  return (
    <div className="flex flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={OUTCOMES} />
      {side === 'SELLER' && plans.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Bidders’ financing</CardTitle>
            <CardDescription>Each bidder’s own plan: how they would fund their offer, as they attest it. No bidder sees another’s.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-4">Bidder</th><th className="py-2 pr-4">Posture</th><th className="py-2">Coverage of their offer</th></tr></thead>
              <tbody className="divide-y divide-border">
                {plans.map((plan) => (
                  <tr key={plan.bidId ?? 'plan'}>
                    <td className="py-2 pr-4 font-medium">{plan.firmName}</td>
                    <td className="py-2 pr-4"><FinancingPosture posture={plan.posture} compact /></td>
                    <td className="py-2">{plan.posture.coverage.against ? `${money(plan.posture.coverage.total, plan.posture.coverage.currency)} of ${money(plan.posture.coverage.against.price, plan.posture.coverage.currency)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {plans.map((plan) => (
        <Card key={plan.bidId ?? 'plan'}>
          <CardHeader>
            <CardTitle>{side === 'BUYER' ? 'How you fund this deal' : plan.firmName ? `${plan.firmName}: how they fund the deal` : 'How the buyer funds the deal'}</CardTitle>
            <CardDescription>
              {side === 'BUYER'
                ? 'The seller sees each source of funds, its amount and status, the coverage and the documents you share. Your private notes and unshared documents stay with your side.'
                : 'As the buyer attests it. “Document-backed” means the buyer shared a letter or proof for it.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <FinancingPosture posture={plan.posture} />
            {side === 'BUYER' && canEdit ? (
              <div className="flex flex-col gap-3">
                {plan.tranches.map((tranche) => (
                  <div key={tranche.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <form action={updateTranche.bind(null, dealId, tranche.id)} className="flex flex-col gap-2">
                      <TrancheFields values={tranche} />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="submit" size="sm" variant="outline">Save</Button>
                        {tranche.needsDocument && !tranche.documented ? <span className="text-xs text-amber-900">From pre-qualification up, attach the letter or proof behind this status.</span> : null}
                      </div>
                    </form>
                    <form action={removeTranche.bind(null, dealId, tranche.id)}><Button type="submit" size="sm" variant="ghost">Remove</Button></form>
                  </div>
                ))}
                <form action={addTranche.bind(null, dealId)} className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
                  <p className="text-sm font-semibold">Add a source of funds</p>
                  <TrancheFields />
                  <div><Button type="submit" size="sm">Add</Button></div>
                </form>
                <form action={savePlan.bind(null, dealId)} className="grid gap-2 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs font-medium">Lender commitment expected by<input name="commitmentExpectedBy" type="date" defaultValue={plan.commitmentExpectedBy ?? ''} className={field} /></label>
                  <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">Private note (your side only)<input name="buyerNote" defaultValue={plan.buyerNote ?? ''} className={field} /></label>
                  <div><Button type="submit" size="sm" variant="outline">Save</Button></div>
                </form>
              </div>
            ) : (
              <>
                <TrancheTable plan={plan} />
                {plan.commitmentExpectedBy ? <p className="text-sm text-slate-text">Lender commitment expected by {plan.commitmentExpectedBy}.</p> : null}
              </>
            )}
            <section aria-label="Documents" className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-navy">Documents</h3>
              <Documents dealId={dealId} plan={plan} side={side} canEdit={canEdit} />
            </section>
            <section aria-label="Earnest money" className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-navy">Earnest money in escrow</h3>
              <Escrow dealId={dealId} plan={plan} side={side} canEdit={canEdit} />
            </section>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
