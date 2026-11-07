import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, HumanBadge } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { dealViewer } from '../../_lib/viewer';
import { formatMoney } from '../../../metrics/_lib/format';
import { parseDealParam } from '../../../valuation/_lib/view';
import { addItem, closeDeal, declineTerms, disputePayment, fixtureSign, nameSignatory, recordPayment, sendForSignature, signOff, tickItem } from './actions';

// Per-user: reads the session.
export const dynamic = 'force-dynamic';

type Side = 'BUYER' | 'SELLER';

interface CloseView {
  me: { side: Side | null };
  signatories: Record<Side, { userId: string; name: string } | null>;
  candidates: Record<Side, { userId: string; name: string }[]>;
  agreed: {
    batchId: string;
    version: number;
    agreedAt: string;
    declinedAt: string | null;
    signoffs: { side: Side; name: string; method: 'IN_APP' | 'ESIGN'; signedAt: string }[];
    envelope: { provider: 'FIXTURE' | 'DOCUSIGN'; status: string; sentAt: string; signedBy: Side[] } | null;
  } | null;
  items: {
    id: string;
    kind: 'CONDITION' | 'FUNDS';
    title: string;
    ownerSide: Side;
    amount: string | null;
    currency: string | null;
    paid: { on: string; reference: string; by: string; proofDocumentId: string | null } | null;
    dispute: { note: string; at: string } | null;
    done: { by: string; at: string } | null;
  }[];
  esign: { provider: 'FIXTURE' | 'DOCUSIGN' | null };
  missing: string[];
  closed: { at: string; buyer: string; seller: string } | null;
}

const SIDE = { BUYER: 'Buyer', SELLER: 'Seller' } as const;
const OUTCOMES: Record<string, string> = {
  'close-here': 'Terms were agreed on Pactlab, so this deal closes here: both sides sign, the checklist is done, then the deal lead closes it.',
  'ok-signatory': 'Signatory named.',
  'ok-signed': 'Signed off.',
  'ok-declined': 'Declined. Agree a new version on Proposed terms.',
  'ok-sent': 'Sent for e-signature. Each signatory signs from the email, or here in a test environment.',
  'ok-esigned': 'Signed.',
  'ok-item': 'Added to the checklist.',
  'ok-ticked': 'Ticked.',
  'ok-paid': 'Payment recorded. The seller confirms receipt.',
  'ok-disputed': 'Sent back to the buyer with your note.',
  'item-title': 'Give the item a short title.',
  'item-amount': 'Enter the amount as a number, e.g. 25,000,000.',
  'paid-invalid': 'Enter the payment date and its reference.',
  'dispute-note': 'Say what is missing, in a few words.',
  conflict: 'That can’t be done right now: something changed, or a step before it is missing. Reload and try again.',
  forbidden: 'That belongs to the other side, or to the signatory.',
  'error-ESIGN_UNAVAILABLE': 'E-signature isn’t set up for your organization. Connect DocuSign in Settings, or sign off in Pactlab.',
  'error-ESIGN_RECONNECT': 'Your DocuSign connection has expired. An admin reconnects it in Settings.',
};

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function Signatories({ dealId, view }: { dealId: string; view: CloseView }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(['BUYER', 'SELLER'] as const).map((side) => {
        const current = view.signatories[side];
        const editable = view.me.side === side && !view.agreed?.signoffs.some((signoff) => signoff.side === side);
        return (
          <div key={side} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{SIDE[side]} signatory</span>
            <span className="font-semibold">{current?.name ?? 'Not named yet'}</span>
            {editable ? (
              <form action={nameSignatory.bind(null, dealId, side)} className="flex gap-2">
                <select name="userId" defaultValue={current?.userId ?? ''} className={inputClass} aria-label={`${SIDE[side]} signatory`}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {view.candidates[side].map((candidate) => (
                    <option key={candidate.userId} value={candidate.userId}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  Name
                </Button>
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Signing({ dealId, view }: { dealId: string; view: CloseView }) {
  const agreed = view.agreed;
  if (!agreed || agreed.declinedAt) {
    return (
      <p className="text-sm text-muted-foreground">
        No agreed version to sign yet. Agree terms on <Link href={`/deals/${dealId}/terms`} className="font-semibold text-indigo-ink underline-offset-4 hover:underline">Proposed terms</Link> first.
      </p>
    );
  }
  const me = view.me.side;
  const iAmSignatory = me !== null && view.signatories[me] !== null && agreed.signoffs.every((signoff) => signoff.side !== me);
  const sent = agreed.envelope?.status === 'SENT';
  const started = agreed.signoffs.length > 0 || sent;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        Agreed version {agreed.version}, {agreed.agreedAt.slice(0, 10)}.{' '}
        <a href={`/deals/${dealId}/closing/term-sheet/${agreed.batchId}`} className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
          Download the term sheet
        </a>
      </p>
      <ul className="flex flex-wrap gap-2">
        {(['BUYER', 'SELLER'] as const).map((side) => {
          const signed = agreed.signoffs.find((signoff) => signoff.side === side);
          return (
            <li key={side}>
              {signed ? (
                <HumanBadge>
                  {SIDE[side]} signed · {signed.name} · {signed.method === 'ESIGN' ? 'e-signature' : 'in Pactlab'}
                </HumanBadge>
              ) : (
                <Badge variant="draft">{SIDE[side]} to sign</Badge>
              )}
            </li>
          );
        })}
      </ul>
      {sent ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <span>
            Out for e-signature ({agreed.envelope?.provider === 'DOCUSIGN' ? 'DocuSign' : 'test e-signature'}) since {agreed.envelope?.sentAt.slice(0, 10)}.
            {agreed.envelope?.signedBy.length ? ` Signed so far: ${agreed.envelope.signedBy.map((side) => SIDE[side]).join(', ')}.` : ''}
          </span>
          {agreed.envelope?.provider === 'FIXTURE' && iAmSignatory && me && !agreed.envelope.signedBy.includes(me) ? (
            <form action={fixtureSign.bind(null, dealId, agreed.batchId)}>
              <Button type="submit" size="sm">
                Sign (test e-signature)
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {!sent && agreed.signoffs.length < 2 ? (
        <div className="flex flex-wrap items-end gap-3">
          {me === 'BUYER' && !started && view.esign.provider ? (
            <form action={sendForSignature.bind(null, dealId, agreed.batchId)} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Final agreement to attach (optional, a shared PDF’s id)
                <input name="agreementDocumentId" placeholder="Document id" className={inputClass} />
              </label>
              <Button type="submit">Send for e-signature{view.esign.provider === 'DOCUSIGN' ? ' (DocuSign)' : ''}</Button>
            </form>
          ) : null}
          {iAmSignatory ? (
            <form action={signOff.bind(null, dealId, agreed.batchId)}>
              <Button type="submit" variant="outline">
                Sign off in Pactlab
              </Button>
            </form>
          ) : null}
          {iAmSignatory && !started ? (
            <form action={declineTerms.bind(null, dealId, agreed.batchId)}>
              <Button type="submit" variant="ghost">
                Decline this version
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Checklist({ dealId, view }: { dealId: string; view: CloseView }) {
  const me = view.me.side;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {view.items.length === 0 ? <p className="text-muted-foreground">Nothing on the checklist yet. Add the conditions to close, and the funds transfer.</p> : null}
      <ul className="flex flex-col divide-y divide-border">
        {view.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {item.done ? <HumanBadge>Done</HumanBadge> : <Badge variant="draft">{item.kind === 'FUNDS' ? (item.paid ? 'Seller to confirm' : 'Buyer to pay') : `${SIDE[item.ownerSide]} to tick`}</Badge>}
              <span className="font-semibold">{item.title}</span>
              {item.kind === 'FUNDS' && item.amount && item.currency ? <span>{formatMoney({ amount: item.amount, currency: item.currency })}</span> : null}
            </div>
            {item.paid ? (
              <span className="text-xs text-muted-foreground">
                Paid on {item.paid.on}, reference {item.paid.reference}, recorded by {item.paid.by}.
              </span>
            ) : null}
            {item.dispute ? <span className="text-xs text-amber-800">Not received: “{item.dispute.note}”</span> : null}
            {item.done ? (
              <span className="text-xs text-muted-foreground">
                {item.kind === 'FUNDS' ? 'Receipt confirmed' : 'Ticked'} by {item.done.by} on {item.done.at.slice(0, 10)}.
              </span>
            ) : item.kind === 'FUNDS' ? (
              me === 'BUYER' && !item.paid ? (
                <form action={recordPayment.bind(null, dealId, item.id)} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                  <input type="date" name="paidOn" required className={inputClass} aria-label="Payment date" />
                  <input name="reference" required maxLength={120} placeholder="Payment reference (wire or ACH)" className={inputClass} aria-label="Payment reference" />
                  <Button type="submit" size="sm">
                    Record payment
                  </Button>
                </form>
              ) : me === 'SELLER' && item.paid ? (
                <div className="flex flex-wrap items-start gap-2">
                  <form action={tickItem.bind(null, dealId, item.id)}>
                    <Button type="submit" size="sm">
                      Confirm received
                    </Button>
                  </form>
                  <form action={disputePayment.bind(null, dealId, item.id)} className="flex flex-wrap gap-2">
                    <input name="note" required minLength={3} maxLength={1000} placeholder="What is missing?" className={inputClass} aria-label="Why not received" />
                    <Button type="submit" size="sm" variant="outline">
                      Not received
                    </Button>
                  </form>
                </div>
              ) : null
            ) : me === item.ownerSide ? (
              <form action={tickItem.bind(null, dealId, item.id)}>
                <Button type="submit" size="sm" variant="outline">
                  Tick
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {me ? (
        <details className="rounded-lg border border-dashed border-border p-3">
          <summary className="cursor-pointer font-semibold">+ Add to the checklist</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <form action={addItem.bind(null, dealId)} className="flex flex-col gap-2">
              <input type="hidden" name="kind" value="CONDITION" />
              <span className="font-medium">A condition to close</span>
              <input name="title" required minLength={2} maxLength={200} placeholder="e.g. Landlord consent to assignment" className={inputClass} />
              <select name="ownerSide" defaultValue={me} className={inputClass} aria-label="Who ticks it">
                <option value="BUYER">The buyer ticks it</option>
                <option value="SELLER">The seller ticks it</option>
              </select>
              <Button type="submit" size="sm" variant="outline" className="self-start">
                Add condition
              </Button>
            </form>
            <form action={addItem.bind(null, dealId)} className="flex flex-col gap-2">
              <input type="hidden" name="kind" value="FUNDS" />
              <span className="font-medium">A funds transfer</span>
              <span className="text-xs text-muted-foreground">Paid outside Pactlab. The buyer records it; the seller confirms receipt. No bank details here.</span>
              <input name="title" maxLength={200} placeholder="Purchase price at completion" className={inputClass} />
              <div className="flex gap-2">
                <input name="amount" required inputMode="decimal" placeholder="Amount" className={inputClass} />
                <input name="currency" defaultValue="USD" maxLength={3} className={`${inputClass} w-24`} aria-label="Currency" />
              </div>
              <Button type="submit" size="sm" variant="outline" className="self-start">
                Add funds transfer
              </Button>
            </form>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Closing (T-107): who signs for each side, the agreed version's sign-off (in
 * Pactlab or by e-signature from the buyer's own DocuSign), the checklist both
 * sides work, with the funds transfer, and the close itself once all is done.
 */
export default async function ClosingPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const dealId = parseDealParam((await params).dealId);
  const outcome = (await searchParams)['outcome'];
  if (!dealId) return <EmptyState title="Choose a deal" description="Open closing from a deal." />;
  const [result, viewer] = await Promise.all([apiGet<CloseView>(`/v1/deals/${encodeURIComponent(dealId)}/close`), dealViewer(dealId)]);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const isLead = viewer?.role === 'DEAL_LEAD';
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />
      {view.closed ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center gap-2">
            <CardTitle className="mr-auto">Closed</CardTitle>
            <HumanBadge>Closed {view.closed.at.slice(0, 10)}</HumanBadge>
          </CardHeader>
          <CardContent className="text-sm">
            Signed for the buyer by {view.closed.buyer} and for the seller by {view.closed.seller}.{' '}
            <Link href={`/deals/${dealId}/post-close`} className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
              Post-close →
            </Link>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Signatories</CardTitle>
          <CardDescription>Each side names who signs for it. Only they sign off the agreed terms.</CardDescription>
        </CardHeader>
        <CardContent>
          <Signatories dealId={dealId} view={view} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start gap-2">
          <div className="mr-auto flex flex-col gap-1.5">
            <CardTitle>Sign the agreed terms</CardTitle>
            <CardDescription>Both signatories sign the term sheet: by e-signature from the buyer’s own DocuSign, or in Pactlab.</CardDescription>
          </div>
          {view.esign.provider === 'FIXTURE' ? (
            <Badge variant="neutral" title="This environment uses a test e-signature">
              test e-signature
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          <Signing dealId={dealId} view={view} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Closing checklist</CardTitle>
          <CardDescription>The conditions to close, each ticked by the side that owns it, and the funds transfer.</CardDescription>
        </CardHeader>
        <CardContent>
          <Checklist dealId={dealId} view={view} />
        </CardContent>
      </Card>
      {!view.closed ? (
        <Card>
          <CardHeader>
            <CardTitle>Close the deal</CardTitle>
            <CardDescription>Closes once both sides have signed the agreed terms and every checklist item is done. The deal lead closes it.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {view.missing.length > 0 ? (
              <ul className="list-disc pl-5 text-muted-foreground">
                {view.missing.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : (
              <p>Everything is in place.</p>
            )}
            {isLead ? (
              <form action={closeDeal.bind(null, dealId)}>
                <Button type="submit" disabled={view.missing.length > 0}>
                  Close the deal
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
