import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '../../../metrics/_lib/format';
import { apiGet } from '../../_lib/api';
import { isUuidParam } from '../../_lib/filters';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { decideSuggestion } from './actions';
import { LEVER_LABELS, STATUS_LOOK, type SuggestionView } from './labels';

export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-approved': 'Approved: it is on the pact now.',
  'ok-rejected': 'Rejected. The app sees your note.',
  failed: 'It could not be carried out — the reason is on the suggestion below. Nothing changed.',
  'already-decided': 'Someone has already decided this one.',
  'invalid-note': 'Keep the note under 2,000 characters.',
  forbidden: 'Your role cannot decide suggestions on this pact.',
};

/** Suggestions from connected AI apps (T-084b): nothing changes until a person here approves one. */
export default async function SuggestionsPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<{ items: SuggestionView[]; connectable: boolean }>(`/v1/deals/${dealId}/agent-proposals`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const open = result.data.items.filter((item) => item.status === 'PENDING' || item.status === 'FAILED');
  const decided = result.data.items.filter((item) => item.status !== 'PENDING' && item.status !== 'FAILED');

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Suggestions from connected apps</h2>
        <p className="text-sm text-muted-foreground">
          AI apps you connected (such as Claude) can suggest a term on a finding or a request for documents. Nothing changes on the pact until someone here approves it, and amounts always
          come from Pactlab, never from the app.
        </p>
      </div>
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      {open.length === 0 ? (
        <EmptyState
          title="Nothing waiting for you"
          description={
            result.data.connectable
              ? 'When a connected app suggests something on this pact, it appears here for you to approve or reject.'
              : 'Connected apps are switched off for your organization.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Waiting for a decision">
          {open.map((item) => (
            <li key={item.id}>
              <Suggestion dealId={dealId} item={item} />
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="Decided">
          <h3 className="text-sm font-semibold">Decided</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {decided.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <Summary item={item} /> <span className="text-xs text-muted-foreground">· {item.clientName}</span>
                  {item.decisionNote ? <span className="block text-xs text-muted-foreground">“{item.decisionNote}”</span> : null}
                </span>
                <Badge variant={STATUS_LOOK[item.status].variant}>{STATUS_LOOK[item.status].label}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Summary({ item }: { item: SuggestionView }) {
  const detail = item.detail;
  if (!detail) return <span>A suggestion that can no longer be read</span>;
  if (detail.kind === 'TERM') {
    return (
      <span>
        {LEVER_LABELS[detail.lever]} for <span className="font-medium">{detail.findingTitle}</span>
      </span>
    );
  }
  return <span>Ask the counterparty for {detail.items.map((entry) => entry.label).join(', ')}</span>;
}

function Suggestion({ dealId, item }: { dealId: string; item: SuggestionView }) {
  const detail = item.detail;
  const approvable = detail !== null && (detail.kind !== 'TERM' || detail.amount !== null);
  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            <Summary item={item} />
          </CardTitle>
          <Badge variant={STATUS_LOOK[item.status].variant}>{STATUS_LOOK[item.status].label}</Badge>
        </div>
        <CardDescription>
          From {item.clientName} · {new Date(item.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {item.problem ? (
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            {item.problem}
          </p>
        ) : null}
        {detail?.kind === 'TERM' ? (
          <p>
            Approving adds a <b>{LEVER_LABELS[detail.lever].toLowerCase()}</b> of <b className="font-mono">{formatMoney(detail.amount)}</b> to your draft terms — the finding’s priced risk at its
            midpoint. <Link className="underline" href={`/deals/${dealId}/findings/${detail.findingId}`}>Open the finding</Link>
            {detail.amount === null ? <span className="block text-muted-foreground">The finding is no longer an accepted priced risk, so this can only be rejected.</span> : null}
          </p>
        ) : detail?.kind === 'DOCUMENT_REQUEST' ? (
          <p>
            Approving sends the counterparty a request for: {detail.items.map((entry) => entry.label).join(', ')}.{detail.note ? <span className="block text-muted-foreground">Note: {detail.note}</span> : null}
          </p>
        ) : null}
        {item.rationale ? (
          <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
            <span className="sr-only">The app’s reasoning: </span>
            {item.rationale}
          </blockquote>
        ) : null}
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
            Note to the app (optional)
            <input name="note" maxLength={2000} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <div className="flex gap-2">
            {approvable ? (
              <Button type="submit" size="sm" formAction={decideSuggestion.bind(null, dealId, item.id, 'APPROVE')}>
                {item.status === 'FAILED' ? 'Try again' : 'Approve'}
              </Button>
            ) : null}
            <Button type="submit" size="sm" variant="outline" formAction={decideSuggestion.bind(null, dealId, item.id, 'REJECT')}>
              Reject
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
