import type { LoiSectionView, LoiStatusView, LoiView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { FileSignature } from 'lucide-react';
import Link from 'next/link';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { declineLoi, draftLoi, fixtureSignLoi, saveLoiFields, sendLoi, setLoiRequired, signLoi } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<LoiStatusView, { label: string; variant: 'neutral' | 'draft' | 'calculation' | 'danger' }> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  SENT: { label: 'Sent, awaiting signatures', variant: 'draft' },
  COUNTERSIGNED: { label: 'Countersigned', variant: 'calculation' },
  DECLINED: { label: 'Declined', variant: 'danger' },
  EXPIRED: { label: 'Expired', variant: 'danger' },
};
const OUTCOMES: Record<string, string> = {
  'ok-drafted': 'Draft created from the agreed terms.',
  'ok-saved': 'Saved.',
  'ok-sent': 'Sent. The buyer’s signatory signs first; then the seller’s countersigns.',
  'ok-signed': 'Signed.',
  'ok-declined': 'Declined.',
  'ok-requirement': 'Saved.',
  'error-TERMS_NOT_AGREED': 'Agree a version of the terms with the seller first.',
  'error-LOI_INCOMPLETE': 'Fill the governing law and name both signatories (Closing) before sending.',
  'error-LOI_BUYER_SIGNS_FIRST': 'The buyer signs first; you countersign after.',
  'error-LOI_DRAFT_OPEN': 'A draft is already open.',
  'error-ESIGN_UNAVAILABLE': 'E-signature isn’t set up for your organization. Send it to sign in Pactlab, or connect DocuSign in Settings.',
  'error-DEMO_NOT_AVAILABLE': 'E-signature is off in a shared demo; sign in Pactlab instead.',
  invalid: 'Check the values and try again.',
  forbidden: 'That is for the deal lead or the named signatory.',
};
const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

function Part({ title, note, sections, tone }: { title: string; note: string; sections: readonly LoiSectionView[]; tone: 'muted' | 'strong' }) {
  return (
    <section aria-label={title} className={`flex flex-col gap-3 rounded-lg border p-4 ${tone === 'strong' ? 'border-indigo/40 bg-indigo/5' : 'border-border'}`}>
      <div>
        <h3 className="font-bold text-navy">{title}</h3>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      {sections.map((section) => (
        <div key={section.heading}>
          <p className="text-sm font-semibold">{section.heading}</p>
          {section.lines.map((line) => (
            <p key={line} className={`text-sm ${line.includes('[to be filled]') ? 'rounded bg-amber-50 px-1 text-amber-900' : 'text-slate-text'}`}>
              {line}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * The letter of intent (T-119): generated from the agreed terms, with the non-binding economics and
 * the binding provisions side by side, then signed by the buyer and countersigned by the seller.
 */
export default async function LoiPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<LoiView>(`/v1/deals/${dealId}/loi`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const current = view.current;
  return (
    <div className="flex flex-col gap-6">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start gap-3">
          <FileSignature aria-hidden className="mt-0.5 h-5 w-5 text-indigo-ink" />
          <div className="mr-auto flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              Letter of intent {current ? <Badge variant={STATUS[current.status].variant}>{`v${current.version} · ${STATUS[current.status].label}`}</Badge> : null}
            </CardTitle>
            <CardDescription>
              Fixes the agreed economics as non-binding intent, and makes exclusivity, confidentiality, law and expenses binding, before the definitive agreement. Generated from the
              agreed terms and the values below; Pactlab writes no legal prose of its own.{' '}
              <span className="font-semibold">Not legal advice: have your counsel review.</span>
            </CardDescription>
          </div>
          {view.canDraft ? (
            <form action={draftLoi.bind(null, dealId)}>
              <Button type="submit">{current ? 'Draft a new version' : 'Draft from the agreed terms'}</Button>
            </form>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {view.agreedTermsVersion === null ? (
            <p>
              Agree a version of the terms with the seller first, on <Link className="text-indigo-ink underline" href={`/deals/${dealId}/terms`}>Proposed terms</Link>.
            </p>
          ) : (
            <p className="text-muted-foreground">Quotes agreed terms version {view.agreedTermsVersion}. Signatories: buyer {view.signatories.BUYER ?? 'not named'}, seller {view.signatories.SELLER ?? 'not named'} (named on Closing).</p>
          )}
          {view.exclusivity ? (
            <p className={view.exclusivity.ended ? 'font-semibold text-rose' : 'font-semibold'}>
              {view.exclusivity.ended ? `Exclusivity ended on ${day(view.exclusivity.endsAt)}.` : `Exclusivity runs until ${day(view.exclusivity.endsAt)} (${view.exclusivity.daysLeft} days left).`}
            </p>
          ) : null}
          {view.canSetRequirement ? (
            <form action={setLoiRequired.bind(null, dealId, !view.required)} className="flex items-center gap-3">
              <span>{view.required ? 'A countersigned letter is required before the definitive terms are signed.' : 'A letter is optional on this pact.'}</span>
              <Button type="submit" size="sm" variant="outline">
                {view.required ? 'Make it optional' : 'Require a letter'}
              </Button>
            </form>
          ) : view.required ? (
            <p>A countersigned letter is required before the definitive terms are signed.</p>
          ) : null}
        </CardContent>
      </Card>

      {current?.canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>The values in the letter</CardTitle>
            <CardDescription>Everything else comes from the agreed terms and the parties. Blank values are highlighted in the letter and must be filled before sending.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveLoiFields.bind(null, dealId, current.id)} className="grid gap-3 text-sm sm:grid-cols-2" aria-label="Letter of intent values">
              <label className="flex flex-col gap-1 font-medium">
                Governing law (required)
                <input name="governingLaw" defaultValue={current.fields.governingLaw} placeholder="e.g. the State of Delaware" className={field} />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Exclusivity (days from countersignature)
                <input name="exclusivityDays" type="number" min={1} max={365} defaultValue={current.fields.exclusivityDays} className={field} />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Diligence (days)
                <input name="diligenceDays" type="number" min={1} max={365} defaultValue={current.fields.diligenceDays} className={field} />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Target date for the definitive agreement
                <input name="targetSigningDate" type="date" defaultValue={current.fields.targetSigningDate ?? ''} className={field} />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Days the seller has to countersign
                <input name="responseDays" type="number" min={1} max={60} defaultValue={current.fields.responseDays} className={field} />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Expenses
                <input name="expenses" defaultValue={current.fields.expenses} className={field} />
              </label>
              <label className="flex flex-col gap-1 font-medium sm:col-span-2">
                Conditions to closing (one per line)
                <textarea name="conditions" rows={3} defaultValue={current.fields.conditions.join('\n')} className={field} />
              </label>
              <div>
                <Button type="submit" variant="outline">
                  Save values
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {current ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start gap-3">
            <div className="mr-auto flex flex-col gap-1">
              <CardTitle>{current.status === 'DRAFT' ? 'As it will read' : 'As sent'}</CardTitle>
              <CardDescription>{current.content.parties}</CardDescription>
            </div>
            {current.hasPdf ? (
              <a className="text-sm font-semibold text-indigo-ink underline" href={`/deals/${dealId}/loi/${current.id}/pdf`}>
                Download the PDF
              </a>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Part title="Non-binding provisions" note="Statements of present intent only. No obligation to close." sections={current.content.nonBinding} tone="muted" />
              <Part title="Binding provisions" note="These bind both parties from countersignature." sections={current.content.binding} tone="strong" />
            </div>
            <p className="text-sm font-semibold">{current.content.signatureNote}</p>
            <p className="text-xs text-muted-foreground">{current.content.notice}</p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {current.canSend ? (
                <>
                  <form action={sendLoi.bind(null, dealId, current.id, 'IN_APP')}>
                    <Button type="submit" disabled={current.content.unfilled.length > 0}>
                      Send to sign in Pactlab
                    </Button>
                  </form>
                  <form action={sendLoi.bind(null, dealId, current.id, 'ESIGN')}>
                    <Button type="submit" variant="outline" disabled={current.content.unfilled.length > 0}>
                      Send by e-signature
                    </Button>
                  </form>
                  {current.content.unfilled.length > 0 ? <span className="text-amber-900">Fill the governing law first.</span> : null}
                </>
              ) : null}
              {current.status !== 'DRAFT' ? (
                <span>
                  Buyer: {current.signedBy.BUYER ? `signed by ${current.signedBy.BUYER}` : 'not signed'} · Seller: {current.signedBy.SELLER ? `countersigned by ${current.signedBy.SELLER}` : 'not signed'}
                  {current.status === 'SENT' && current.respondBy ? ` · answer by ${day(current.respondBy)}` : ''}
                </span>
              ) : null}
              {current.canSign ? (
                <form action={signLoi.bind(null, dealId, current.id)}>
                  <Button type="submit">{current.signedBy.BUYER ? 'Countersign' : 'Sign'}</Button>
                </form>
              ) : null}
              {current.canFixtureSign ? (
                <form action={fixtureSignLoi.bind(null, dealId, current.id)}>
                  <Button type="submit" variant="outline">
                    Sign the envelope (test)
                  </Button>
                </form>
              ) : null}
              {current.canDecline ? (
                <form action={declineLoi.bind(null, dealId, current.id)}>
                  <Button type="submit" variant="ghost">
                    Decline
                  </Button>
                </form>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : view.agreedTermsVersion !== null && !view.canDraft ? (
        <EmptyState title="No letter yet" description="The buyer’s deal lead drafts the letter from the agreed terms." />
      ) : null}

      {view.versions.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Earlier versions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {view.versions.slice(1).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">v{row.version}</span>
                  <Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge>
                  <span className="text-muted-foreground">sent {day(row.sentAt)}</span>
                  {row.hasPdf ? (
                    <a className="text-indigo-ink underline" href={`/deals/${dealId}/loi/${row.id}/pdf`}>
                      PDF
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
