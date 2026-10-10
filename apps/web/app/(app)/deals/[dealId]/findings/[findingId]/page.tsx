import { PRICED_RISK_TYPES, type Finding, type FindingReview } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DOMAIN_LABELS, formatPricedRisk, PRICED_RISK_LABELS, statusVariant } from '../../../../findings/_lib/view';
import { apiGet } from '../../../_lib/api';
import { isUuidParam } from '../../../_lib/filters';
import { OutcomeBanner } from '../../../_lib/outcome';
import { ApiState } from '../../../_lib/states';
import { can, dealViewer } from '../../../_lib/viewer';
import { decideFinding, priceFinding } from '../actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-submitted': 'Submitted for review.',
  'ok-accepted': 'Finding accepted. Its priced risk can now adjust valuation scenarios.',
  'ok-rejected': 'Finding rejected.',
  'ok-support_requested': 'Sent back to draft with a request for more support.',
  'ok-priced': 'Priced risk saved.',
  'ok-cleared': 'Priced risk removed.',
  rationale: 'Write a short rationale for the decision.',
  price: 'Enter a type, currency, low and high amounts and the basis for the price.',
  invalid: 'Not accepted. Check that low does not exceed high, and that the finding has resolvable evidence before accepting it.',
};

const DECISION_TEXT: Record<FindingReview['decision'], string> = {
  SUBMITTED: 'Submitted for review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  SUPPORT_REQUESTED: 'Asked for more support',
};

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/** One finding: what it says, what it cites, what it is worth, and who decided what. */
export default async function FindingPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string; findingId: string }>;
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { dealId, findingId } = await params;
  const { outcome } = await searchParams;
  if (!isUuidParam(dealId) || !isUuidParam(findingId)) notFound();
  const [result, viewer] = await Promise.all([
    apiGet<{ finding: Finding; reviews: FindingReview[] }>(`/v1/deals/${dealId}/findings/${findingId}`),
    dealViewer(dealId),
  ]);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const { finding, reviews } = result.data;
  const decide = decideFinding.bind(null, dealId, findingId);
  const price = priceFinding.bind(null, dealId, findingId);
  const canDraft = can.draft(viewer.role);
  const canReview = can.review(viewer.role);

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/deals/${dealId}/findings`} className="text-sm text-muted-foreground hover:underline">
        ← All findings
      </Link>
      <OutcomeBanner outcome={outcome} messages={OUTCOMES} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(finding.status)}>{finding.status.replace('_', ' ').toLowerCase()}</Badge>
          <Badge>{DOMAIN_LABELS[finding.domain]}</Badge>
          <Badge variant={finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 'danger' : 'neutral'}>
            {finding.severity.toLowerCase()} severity
          </Badge>
          <Badge variant="draft">{finding.origin.toLowerCase()} draft</Badge>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{finding.title}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{finding.description}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evidence</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {finding.evidence.length === 0 ? (
                <p className="text-muted-foreground">No evidence linked. A finding cannot be accepted without it.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {finding.evidence.map((link) => (
                    <li key={`${link.evidenceItemId}-${link.toolName}`} className="flex flex-wrap items-center gap-2">
                      <Link href={`/deals/${dealId}/evidence/${link.evidenceItemId}`}>
                        <Badge variant="evidence">open evidence</Badge>
                      </Link>
                      <span className="font-mono">{link.commitSha.slice(0, 12)}</span>
                      <span className="text-muted-foreground">
                        {link.toolName}@{link.toolVersion}
                        {link.path ? ` · ${link.path}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review history</CardTitle>
            </CardHeader>
            <CardContent>
              {reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">No decisions yet.</p>
              ) : (
                <ol className="flex flex-col gap-4 border-l-2 border-border pl-4 text-sm">
                  {reviews.map((review) => (
                    <li key={review.id} className="flex flex-col gap-1">
                      <span className="font-medium">
                        {DECISION_TEXT[review.decision]} · {viewer.name(review.reviewerUserId)}{' '}
                        <span className="font-normal text-muted-foreground">({review.reviewerRole.replace('_', ' ').toLowerCase()})</span>
                      </span>
                      <span className="text-muted-foreground">{when.format(new Date(review.decidedAt))} UTC</span>
                      <span>“{review.rationale}”</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Priced risk</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <div>
                <p className="font-mono text-lg">{formatPricedRisk(finding.pricedRisk)}</p>
                {finding.pricedRisk ? (
                  <p className="text-muted-foreground">
                    {PRICED_RISK_LABELS[finding.pricedRisk.type]} · {finding.pricedRisk.basis}
                  </p>
                ) : (
                  <p className="text-muted-foreground">Not priced yet.</p>
                )}
              </div>
              {finding.status === 'DRAFT' && canDraft ? (
                <form action={price} className="flex flex-col gap-3 border-t border-border pt-4">
                  <input type="hidden" name="expectedVersion" value={finding.version} />
                  <label className="flex flex-col gap-1 font-medium">
                    Type
                    <select name="type" defaultValue={finding.pricedRisk?.type ?? 'PRICE_REDUCTION'} className={inputClass}>
                      {PRICED_RISK_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {PRICED_RISK_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1 font-medium">
                      Currency
                      <input name="currency" defaultValue={finding.pricedRisk?.currency ?? 'USD'} maxLength={3} className={`${inputClass} uppercase`} />
                    </label>
                    <label className="flex flex-col gap-1 font-medium">
                      Low
                      <input name="low" inputMode="decimal" defaultValue={finding.pricedRisk?.low ?? ''} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 font-medium">
                      High
                      <input name="high" inputMode="decimal" defaultValue={finding.pricedRisk?.high ?? ''} className={inputClass} />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 font-medium">
                    Basis
                    <textarea name="basis" rows={2} defaultValue={finding.pricedRisk?.basis ?? ''} className={inputClass} />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      Save price
                    </Button>
                    {finding.pricedRisk ? (
                      <Button type="submit" name="clear" value="1" size="sm" variant="ghost">
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Decision</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {finding.status === 'DRAFT' && canDraft ? (
                <form action={decide} className="flex flex-col gap-3">
                  <input type="hidden" name="expectedVersion" value={finding.version} />
                  <input type="hidden" name="decision" value="SUBMITTED" />
                  <p className="text-muted-foreground">Send this draft to a reviewer. Nothing is accepted by a machine.</p>
                  <textarea name="rationale" rows={2} required placeholder="What you checked" className={inputClass} />
                  <div>
                    <Button type="submit" size="sm">
                      Submit for review
                    </Button>
                  </div>
                </form>
              ) : finding.status === 'IN_REVIEW' && canReview ? (
                <form action={decide} className="flex flex-col gap-3">
                  <input type="hidden" name="expectedVersion" value={finding.version} />
                  <p className="text-muted-foreground">Your decision is recorded with your name and rationale.</p>
                  <textarea name="rationale" rows={3} required placeholder="Why you decided this way" className={inputClass} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" name="decision" value="ACCEPTED" size="sm">
                      Accept
                    </Button>
                    <Button type="submit" name="decision" value="REJECTED" size="sm" variant="outline">
                      Reject
                    </Button>
                    <Button type="submit" name="decision" value="SUPPORT_REQUESTED" size="sm" variant="ghost">
                      Ask for support
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="text-muted-foreground">
                  {finding.status === 'ACCEPTED'
                    ? 'Accepted. Link it to a valuation scenario to adjust the price.'
                    : finding.status === 'REJECTED'
                      ? 'Rejected. No further action.'
                      : finding.status === 'IN_REVIEW'
                        ? 'Waiting for a deal lead or reviewer.'
                        : 'Waiting for someone with write access to submit it.'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
