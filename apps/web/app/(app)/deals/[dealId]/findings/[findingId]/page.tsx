import { PRICED_RISK_TYPES, type Finding, type FindingReview } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DIRECTION_LABELS,
  directionText,
  directionVariant,
  DOMAIN_LABELS,
  formatPricedRisk,
  PRICED_RISK_LABELS,
  RULE_MESSAGES,
  statusVariant,
} from '../../../../findings/_lib/view';
import { apiGet } from '../../../_lib/api';
import { isUuidParam } from '../../../_lib/filters';
import { OutcomeBanner } from '../../../_lib/outcome';
import { ApiState } from '../../../_lib/states';
import { can, dealViewer } from '../../../_lib/viewer';
import { decideFinding, priceFinding, setFindingDirection } from '../actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-submitted': 'Submitted for review.',
  'ok-accepted': 'Finding accepted with its direction. A drag can now adjust valuation scenarios; a cushion appears as value confirmed.',
  'ok-direction': 'Direction saved.',
  direction: 'The direction could not be saved. A cushion needs a value driver and basis; amounts must be numbers with low not above high.',
  'direction-cushion': 'Say which value driver this cushion confirms, and the basis for it.',
  'direction-neutral': 'Say why this finding does not move value.',
  ...Object.fromEntries(Object.entries(RULE_MESSAGES).map(([code, message]) => [`rule-${code}`, message])),
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
  const setDirection = setFindingDirection.bind(null, dealId, findingId);
  const confirmation = finding.valueConfirmation;
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
          <Badge variant={directionVariant(finding.direction)} title={finding.direction === null ? undefined : DIRECTION_LABELS[String(finding.direction)]?.help}>
            {finding.status === 'ACCEPTED' ? '' : 'proposed '}
            {directionText(finding.direction)}
          </Badge>
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
                      {review.direction !== null ? (
                        <span className="text-muted-foreground">
                          Decided as {directionText(review.direction)}
                          {review.directionRationale ? ` — “${review.directionRationale}”` : ''}
                        </span>
                      ) : null}
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
              <CardTitle className="text-base">Valuation direction</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={directionVariant(finding.direction)}>{directionText(finding.direction)}</Badge>
                {finding.direction !== null ? <span className="text-muted-foreground">{DIRECTION_LABELS[String(finding.direction)]?.help}</span> : null}
              </div>
              {confirmation ? (
                <p>
                  Confirms <b>{confirmation.valueDriver}</b>
                  {confirmation.impliedValue
                    ? ` · implied ${confirmation.impliedValue.currency} ${confirmation.impliedValue.low}–${confirmation.impliedValue.high}`
                    : ' · no implied value'}{' '}
                  — {confirmation.basis}
                </p>
              ) : null}
              {finding.directionRationale ? <p className="text-muted-foreground">Why: “{finding.directionRationale}”</p> : null}
              {finding.status === 'DRAFT' && canDraft ? (
                <form action={setDirection} className="flex flex-col gap-3 border-t border-border pt-4">
                  <input type="hidden" name="expectedVersion" value={finding.version} />
                  <fieldset className="flex flex-wrap gap-2">
                    <legend className="sr-only">Direction</legend>
                    {(['-1', '1', '0'] as const).map((value) => (
                      <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 has-[:checked]:border-indigo has-[:checked]:bg-secondary">
                        <input type="radio" name="direction" value={value} required defaultChecked={String(finding.direction) === value} />
                        {DIRECTION_LABELS[value]?.label}
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-xs text-muted-foreground">
                    Drag: price it in “Priced risk”. Cushion: say what it confirms (any price is removed). Neutral: say why (any price is removed).
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input name="valueDriver" defaultValue={confirmation?.valueDriver ?? ''} placeholder="Cushion: value driver, e.g. ARR quality" className={inputClass} />
                    <input name="valueBasis" defaultValue={confirmation?.basis ?? ''} placeholder="Cushion: basis" className={inputClass} />
                    <input name="valueLow" inputMode="decimal" defaultValue={confirmation?.impliedValue?.low ?? ''} placeholder="Implied value low (optional)" className={inputClass} />
                    <input name="valueHigh" inputMode="decimal" defaultValue={confirmation?.impliedValue?.high ?? ''} placeholder="Implied value high (optional)" className={inputClass} />
                    <input name="valueCurrency" defaultValue={confirmation?.impliedValue?.currency ?? 'USD'} maxLength={3} className={`${inputClass} uppercase`} />
                  </div>
                  <textarea name="directionRationale" rows={2} defaultValue={finding.directionRationale ?? ''} placeholder="Neutral: why it moves no value" className={inputClass} />
                  <div>
                    <Button type="submit" size="sm" variant="outline">
                      Save direction
                    </Button>
                  </div>
                </form>
              ) : null}
            </CardContent>
          </Card>

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
                  <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <label className="flex flex-col gap-1 font-medium">
                      Accept as
                      <select name="direction" defaultValue="" className={inputClass}>
                        <option value="">
                          {finding.direction === null ? 'Choose a direction…' : `Proposed: ${directionText(finding.direction)} (confirm)`}
                        </option>
                        {(['-1', '1', '0'] as const)
                          .filter((value) => value !== String(finding.direction))
                          .map((value) => (
                            <option key={value} value={value}>
                              {finding.direction === null ? '' : 'Override to '}
                              {DIRECTION_LABELS[value]?.label.toLowerCase()}
                            </option>
                          ))}
                      </select>
                    </label>
                    <input name="directionRationale" placeholder="Why, if you change it or choose neutral" className={inputClass} />
                    <span className="text-xs text-muted-foreground">
                      A drag must already be priced; a cushion must already say what it confirms. Otherwise, ask for support.
                    </span>
                  </div>
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
