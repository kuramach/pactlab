import type { IcStateView, IcView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { Gavel } from 'lucide-react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addressCondition, clearCondition, decideIc, setIcRequirement, submitToIc } from './actions';

export const dynamic = 'force-dynamic';

const STATE: Record<IcStateView, { label: string; variant: 'neutral' | 'draft' | 'calculation' | 'danger' | 'reviewed' }> = {
  NONE: { label: 'Not submitted', variant: 'neutral' },
  SUBMITTED: { label: 'Awaiting the committee', variant: 'draft' },
  APPROVED: { label: 'Approved', variant: 'calculation' },
  CONDITIONS_OPEN: { label: 'Approved, conditions open', variant: 'reviewed' },
  DECLINED: { label: 'Declined', variant: 'danger' },
};
const DECISION: Record<string, string> = { APPROVE: 'Approved', APPROVE_WITH_CONDITIONS: 'Approved with conditions', DECLINE: 'Declined' };
const CONDITION: Record<string, string> = { OPEN: 'Open', ADDRESSED: 'Addressed', CLEARED: 'Cleared' };
const OUTCOMES: Record<string, string> = {
  'ok-submitted': 'Submitted. The IC pack is being generated; the committee can decide once it is ready.',
  'ok-decided': 'Decision recorded.',
  'ok-addressed': 'Condition marked addressed.',
  'ok-cleared': 'Condition cleared.',
  'ok-requirement': 'Saved.',
  'error-IC_AWAITING_DECISION': 'The committee has not decided the last pack yet.',
  'error-IC_NOT_LATEST': 'Only the latest pack can be decided.',
  'error-IC_ALREADY_DECIDED': 'That pack has already been decided.',
  'invalid-decision': 'Choose a decision and say why, in a sentence.',
  'invalid-conditions': 'Write each condition on its own line.',
  forbidden: 'That is for the deal lead, the deal team or the committee.',
};
const when = (iso: string) => iso.replace('T', ' ').slice(0, 16) + ' UTC';
const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * The investment committee (T-118): the deal team submits an IC pack, a committee member decides
 * it, conditions are worked off, and — when required — signing waits for approval. Buyer side only.
 */
export default async function IcPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<IcView>(`/v1/deals/${dealId}/ic`);
  if (result.kind === 'forbidden') return <EmptyState title="Not available" description="This part of the pact belongs to the buying team." />;
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const latest = view.submissions[0];
  return (
    <div className="flex flex-col gap-6">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start gap-3">
          <Gavel aria-hidden className="mt-0.5 h-5 w-5 text-indigo-ink" />
          <div className="mr-auto flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              Investment committee <Badge variant={STATE[view.state].variant}>{STATE[view.state].label}</Badge>
            </CardTitle>
            <CardDescription>
              {view.required ? 'Signing waits for the committee’s approval on this pact.' : 'The committee’s approval is not required to sign this pact; its decision is still kept on the record.'} The seller never sees
              any of this.
            </CardDescription>
          </div>
          {view.canSubmit ? (
            <form action={submitToIc.bind(null, dealId)}>
              <Button type="submit">{view.submissions.length > 0 ? 'Submit a revised pack' : 'Submit to the committee'}</Button>
            </form>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div>
            <span className="font-semibold">Committee: </span>
            {view.committee.length > 0
              ? view.committee.map((member) => `${member.name}${member.source === 'PACT' ? ' (this pact)' : ''}`).join(', ')
              : 'No one yet. Owners and admins name the organization’s committee in Settings; the deal lead can also add a committee member on the Team tab.'}
          </div>
          {view.canSetRequirement ? (
            <form action={setIcRequirement.bind(null, dealId)} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 font-medium">
                Approval before signing
                <select name="required" defaultValue={view.requirement.pact === null ? 'org' : view.requirement.pact ? 'yes' : 'no'} className={field}>
                  <option value="org">Follow the organization ({view.requirement.organization ? 'required' : 'not required'})</option>
                  <option value="yes">Required for this pact</option>
                  <option value="no">Not required for this pact</option>
                </select>
              </label>
              <Button type="submit" variant="outline" size="sm">
                Save
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {latest && view.canDecide ? (
        <Card>
          <CardHeader>
            <CardTitle>Your decision on pack v{latest.version}</CardTitle>
            <CardDescription>
              Read the pack first ({latest.reportStatus === 'READY' ? <a className="text-indigo-ink underline" href={`/reports/${latest.reportId}/pdf`}>download it</a> : 'still being generated'}). One decision per pack, recorded with your name.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={decideIc.bind(null, dealId, latest.id)} className="flex flex-col gap-3 text-sm" aria-label="Committee decision">
              <fieldset className="flex flex-wrap gap-4">
                <legend className="sr-only">Decision</legend>
                {(['APPROVE', 'APPROVE_WITH_CONDITIONS', 'DECLINE'] as const).map((decision) => (
                  <label key={decision} className="flex items-center gap-2">
                    <input type="radio" name="decision" value={decision} required /> {DECISION[decision]}
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1 font-medium">
                Why
                <textarea name="note" required minLength={3} rows={3} className={field} />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Conditions (one per line; only with “approved with conditions”)
                <textarea name="conditions" rows={3} className={field} />
              </label>
              <div>
                <Button type="submit">Record the decision</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
          <CardDescription>Every pack put to the committee and what it decided. Nothing here is ever changed afterwards.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {view.submissions.length === 0 ? <p className="text-muted-foreground">No pack submitted yet.</p> : null}
          {view.submissions.map((submission) => (
            <div key={submission.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Pack v{submission.version}</span>
                <span className="text-muted-foreground">
                  submitted {when(submission.submittedAt)}
                  {submission.submittedByName ? ` by ${submission.submittedByName}` : ''}
                </span>
                {submission.reportStatus === 'READY' ? (
                  <a className="text-indigo-ink underline" href={`/reports/${submission.reportId}/pdf`}>
                    Download
                  </a>
                ) : null}
              </div>
              {submission.decision ? (
                <p className="mt-2">
                  <Badge variant={submission.decision.decision === 'DECLINE' ? 'danger' : 'calculation'}>{DECISION[submission.decision.decision]}</Badge>{' '}
                  {when(submission.decision.decidedAt)}
                  {submission.decision.decidedByName ? ` by ${submission.decision.decidedByName}` : ''}: {submission.decision.note}
                </p>
              ) : (
                <p className="mt-2 text-muted-foreground">Awaiting the committee.</p>
              )}
              {submission.conditions.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-2" aria-label={`Conditions on pack v${submission.version}`}>
                  {submission.conditions.map((condition) => (
                    <li key={condition.id} className="flex flex-wrap items-center gap-2">
                      <Badge variant={condition.status === 'OPEN' ? 'draft' : 'calculation'}>{CONDITION[condition.status]}</Badge>
                      <span className="mr-auto">{condition.text}</span>
                      {condition.status === 'OPEN' && view.canAddress ? (
                        <form action={addressCondition.bind(null, dealId, condition.id)} className="flex items-center gap-2">
                          <input name="note" placeholder="How (optional)" className={`${field} w-56`} />
                          <Button type="submit" size="sm" variant="outline">
                            Mark addressed
                          </Button>
                        </form>
                      ) : null}
                      {condition.status !== 'CLEARED' && view.canClear ? (
                        <form action={clearCondition.bind(null, dealId, condition.id)}>
                          <Button type="submit" size="sm" variant="ghost">
                            Clear
                          </Button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
