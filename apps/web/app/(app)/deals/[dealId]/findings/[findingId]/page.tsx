import type { ClaimView } from '@pactlab/contracts';
import { PRICED_RISK_TYPES, type Finding, type FindingReview, type SourceWithdrawnFlag } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { directionText, directionVariant, formatPricedRisk, statusVariant } from '../../../../findings/_lib/view';
import { getI18n } from '../../../../../../lib/i18n/server';
import { apiGet } from '../../../_lib/api';
import { isUuidParam } from '../../../_lib/filters';
import { OutcomeBanner } from '../../../_lib/outcome';
import { ApiState } from '../../../_lib/states';
import { FindingEvidenceChip } from '../../../_lib/finding-evidence';
import { can, dealViewer } from '../../../_lib/viewer';
import { decideFinding, priceFinding, setFindingDirection } from '../actions';
import { claimsFor, HandSourcedBadge, SellerClaims } from '../../../_lib/seller-claims';
import { provenanceLine } from '../../documents/rinse-provenance';
import type { DocumentProvenanceView } from '@pactlab/contracts';
import { SourceWithdrawnBadge, SourceWithdrawnNotice } from '../../../_lib/source-withdrawn';
import { pactCurrency } from '../../../_lib/pact-currency';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** One finding: what it says, what it cites, what it is worth, and who decided what. */
export default async function FindingPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string; findingId: string }>;
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { dealId, findingId } = await params;
  const t = await getI18n();
  const words = t.m.findings;
  const page = words.detail;
  const outcomes = { ...page.outcomes, ...Object.fromEntries(Object.entries(words.rules).map(([code, message]) => [`rule-${code}`, message])) };
  const { outcome } = await searchParams;
  if (!isUuidParam(dealId) || !isUuidParam(findingId)) notFound();
  const [result, viewer, claimsResult, currency] = await Promise.all([
    apiGet<{ finding: Finding; reviews: FindingReview[]; sourceWithdrawn?: SourceWithdrawnFlag[] }>(`/v1/deals/${dealId}/findings/${findingId}`),
    dealViewer(dealId),
    apiGet<{ items: ClaimView[] }>(`/v1/deals/${dealId}/claims`),
    pactCurrency(dealId),
  ]);
  const linkedClaims = claimsResult.kind === 'ok' ? claimsFor(claimsResult.data.items, findingId) : [];
  if (result.kind !== 'ok') return <ApiState result={result} t={t} />;
  const { finding, reviews, sourceWithdrawn } = result.data;
  // A cited page from a set finished in Pactlab Rinse names the seller's original it reproduces (T-178d).
  const citedDocuments = [...new Set(finding.evidence.flatMap((link) => (link.documentCitation ? [link.documentCitation.documentId] : [])))];
  const provenance = citedDocuments.length
    ? await apiGet<{ items: DocumentProvenanceView[] }>(`/v1/deals/${dealId}/document-provenance?${citedDocuments.map((id) => `documentId=${encodeURIComponent(id)}`).join('&')}`)
    : null;
  const provenanceOf = (documentId: string) => (provenance?.kind === 'ok' ? provenance.data.items.find((item) => item.documentId === documentId) : undefined);
  const decide = decideFinding.bind(null, dealId, findingId);
  const price = priceFinding.bind(null, dealId, findingId);
  const setDirection = setFindingDirection.bind(null, dealId, findingId);
  const confirmation = finding.valueConfirmation;
  const canDraft = can.draft(viewer.role);
  const canReview = can.review(viewer.role);

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/deals/${dealId}/findings`} className="text-sm text-muted-foreground hover:underline">
        {page.back}
      </Link>
      <OutcomeBanner outcome={outcome} messages={outcomes} t={t} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(finding.status)}>{words.statuses[finding.status]}</Badge>
          <Badge>{words.domains[finding.domain]}</Badge>
          <Badge variant={finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 'danger' : 'neutral'}>
            {t.fill(page.severity, { severity: words.severities[finding.severity] })}
          </Badge>
          <Badge variant="draft">{t.fill(page.originDraft, { origin: words.origins[finding.origin] })}</Badge>
          <SourceWithdrawnBadge flags={sourceWithdrawn} t={t} />
          <HandSourcedBadge claims={linkedClaims} t={t} />
          <Badge variant={directionVariant(finding.direction)} title={finding.direction === null ? undefined : words.directions[String(finding.direction) as '-1' | '0' | '1'].help}>
            {finding.status === 'ACCEPTED' ? directionText(finding.direction, t) : t.fill(page.proposed, { direction: directionText(finding.direction, t) })}
          </Badge>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{finding.title}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{finding.description}</p>
        <SourceWithdrawnNotice dealId={dealId} flags={sourceWithdrawn} subject={page.thisFinding} t={t} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{page.sellerSaid}</CardTitle>
            </CardHeader>
            <CardContent>
              <SellerClaims claims={linkedClaims} t={t} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{page.evidence}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {finding.evidence.length === 0 ? (
                <p className="text-muted-foreground">{page.noEvidence}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {finding.evidence.map((link) => (
                    <li key={`${link.evidenceItemId ?? link.documentCitation?.quoteHash}-${link.toolName}`} className="flex flex-wrap items-center gap-2">
                      <FindingEvidenceChip link={link} dealId={dealId} from={`/deals/${dealId}/findings/${findingId}`} label={t.m.common.evidence.open} t={t} />
                      {link.commitSha ? <span className="font-mono">{link.commitSha.slice(0, 12)}</span> : null}
                      <span className="text-muted-foreground">
                        {link.toolName}@{link.toolVersion}
                        {link.path ? ` · ${link.path}` : ''}
                      </span>
                      {link.documentCitation && provenanceOf(link.documentCitation.documentId) ? (
                        <span className="w-full text-xs text-muted-foreground">{provenanceLine(provenanceOf(link.documentCitation.documentId) as DocumentProvenanceView)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{page.history}</CardTitle>
            </CardHeader>
            <CardContent>
              {reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">{page.noDecisions}</p>
              ) : (
                <ol className="flex flex-col gap-4 border-l-2 border-border pl-4 text-sm">
                  {reviews.map((review) => (
                    <li key={review.id} className="flex flex-col gap-1">
                      <span className="font-medium">
                        {page.decisions[review.decision]} · {viewer.name(review.reviewerUserId)}{' '}
                        <span className="font-normal text-muted-foreground">({page.roles[review.reviewerRole]})</span>
                      </span>
                      <span className="text-muted-foreground">{t.fill(page.decidedAt, { when: t.dateTime(new Date(review.decidedAt)) })}</span>
                      <span>“{review.rationale}”</span>
                      {review.direction !== null ? (
                        <span className="text-muted-foreground">
                          {review.directionRationale
                            ? t.fill(page.decidedAsWhy, { direction: directionText(review.direction, t), rationale: review.directionRationale })
                            : t.fill(page.decidedAs, { direction: directionText(review.direction, t) })}
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
              <CardTitle className="text-base">{page.direction.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={directionVariant(finding.direction)}>{directionText(finding.direction, t)}</Badge>
                {finding.direction !== null ? <span className="text-muted-foreground">{words.directions[String(finding.direction) as '-1' | '0' | '1'].help}</span> : null}
              </div>
              {confirmation ? (
                <p>
                  {page.direction.confirms} <b>{confirmation.valueDriver}</b>
                  {confirmation.impliedValue
                    ? t.fill(page.direction.implied, { range: t.moneyRange(confirmation.impliedValue.low, confirmation.impliedValue.high, confirmation.impliedValue.currency) })
                    : page.direction.noImplied}{' '}
                  — {confirmation.basis}
                </p>
              ) : null}
              {finding.directionRationale ? <p className="text-muted-foreground">{t.fill(page.direction.why, { rationale: finding.directionRationale })}</p> : null}
              {finding.status === 'DRAFT' && canDraft ? (
                <form action={setDirection} className="flex flex-col gap-3 border-t border-border pt-4">
                  <input type="hidden" name="expectedVersion" value={finding.version} />
                  <fieldset className="flex flex-wrap gap-2">
                    <legend className="sr-only">{page.direction.legend}</legend>
                    {(['-1', '1', '0'] as const).map((value) => (
                      <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 has-[:checked]:border-indigo has-[:checked]:bg-secondary">
                        <input type="radio" name="direction" value={value} required defaultChecked={String(finding.direction) === value} />
                        {words.directions[value].label}
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-xs text-muted-foreground">{page.direction.help}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input name="valueDriver" defaultValue={confirmation?.valueDriver ?? ''} placeholder={page.direction.driver} className={inputClass} />
                    <input name="valueBasis" defaultValue={confirmation?.basis ?? ''} placeholder={page.direction.basis} className={inputClass} />
                    <input name="valueLow" inputMode="decimal" defaultValue={confirmation?.impliedValue?.low ?? ''} placeholder={page.direction.low} className={inputClass} />
                    <input name="valueHigh" inputMode="decimal" defaultValue={confirmation?.impliedValue?.high ?? ''} placeholder={page.direction.high} className={inputClass} />
                    <input name="valueCurrency" defaultValue={confirmation?.impliedValue?.currency ?? currency} maxLength={3} className={`${inputClass} uppercase`} />
                  </div>
                  <textarea name="directionRationale" rows={2} defaultValue={finding.directionRationale ?? ''} placeholder={page.direction.neutralWhy} className={inputClass} />
                  <div>
                    <Button type="submit" size="sm" variant="outline">
                      {page.direction.save}
                    </Button>
                  </div>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{page.price.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <div>
                <p className="font-mono text-lg">{formatPricedRisk(finding.pricedRisk, t)}</p>
                {finding.pricedRisk ? (
                  <p className="text-muted-foreground">
                    {words.pricedRiskTypes[finding.pricedRisk.type]} · {finding.pricedRisk.basis}
                  </p>
                ) : (
                  <p className="text-muted-foreground">{page.price.notYet}</p>
                )}
              </div>
              {finding.status === 'DRAFT' && canDraft ? (
                <form action={price} className="flex flex-col gap-3 border-t border-border pt-4">
                  <input type="hidden" name="expectedVersion" value={finding.version} />
                  <label className="flex flex-col gap-1 font-medium">
                    {page.price.type}
                    <select name="type" defaultValue={finding.pricedRisk?.type ?? 'PRICE_REDUCTION'} className={inputClass}>
                      {PRICED_RISK_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {words.pricedRiskTypes[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1 font-medium">
                      {page.price.currency}
                      <input name="currency" defaultValue={finding.pricedRisk?.currency ?? currency} maxLength={3} className={`${inputClass} uppercase`} />
                    </label>
                    <label className="flex flex-col gap-1 font-medium">
                      {page.price.low}
                      <input name="low" inputMode="decimal" defaultValue={finding.pricedRisk?.low ?? ''} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 font-medium">
                      {page.price.high}
                      <input name="high" inputMode="decimal" defaultValue={finding.pricedRisk?.high ?? ''} className={inputClass} />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 font-medium">
                    {page.price.basis}
                    <textarea name="basis" rows={2} defaultValue={finding.pricedRisk?.basis ?? ''} className={inputClass} />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      {page.price.save}
                    </Button>
                    {finding.pricedRisk ? (
                      <Button type="submit" name="clear" value="1" size="sm" variant="ghost">
                        {page.price.remove}
                      </Button>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{page.decision.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {finding.status === 'DRAFT' && canDraft ? (
                <form action={decide} className="flex flex-col gap-3">
                  <input type="hidden" name="expectedVersion" value={finding.version} />
                  <input type="hidden" name="decision" value="SUBMITTED" />
                  <p className="text-muted-foreground">{page.decision.submitHelp}</p>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {page.decision.reason} <span className="text-xs font-normal text-muted-foreground">{page.decision.required}</span>
                    <textarea name="rationale" rows={2} required placeholder={page.decision.submitPlaceholder} className={inputClass} />
                  </label>
                  <div>
                    <Button type="submit" size="sm">
                      {page.decision.submit}
                    </Button>
                  </div>
                </form>
              ) : finding.status === 'IN_REVIEW' && canReview ? (
                <form action={decide} className="flex flex-col gap-3">
                  <input type="hidden" name="expectedVersion" value={finding.version} />
                  <p className="text-muted-foreground">{page.decision.reviewHelp}</p>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {page.decision.reviewReason} <span className="text-xs font-normal text-muted-foreground">{page.decision.required}</span>
                    <textarea
                      name="rationale"
                      rows={3}
                      required
                      placeholder={page.decision.reviewPlaceholder}
                      className={inputClass}
                    />
                  </label>
                  <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <label className="flex flex-col gap-1 font-medium">
                      {page.decision.acceptAs}
                      <select name="direction" defaultValue="" className={inputClass}>
                        <option value="">
                          {finding.direction === null ? page.decision.choose : t.fill(page.decision.proposedConfirm, { direction: directionText(finding.direction, t) })}
                        </option>
                        {(['-1', '1', '0'] as const)
                          .filter((value) => value !== String(finding.direction))
                          .map((value) => (
                            <option key={value} value={value}>
                              {finding.direction === null ? words.directions[value].word : t.fill(page.decision.overrideTo, { direction: words.directions[value].word })}
                            </option>
                          ))}
                      </select>
                    </label>
                    <input name="directionRationale" placeholder={page.decision.changeWhy} className={inputClass} />
                    <span className="text-xs text-muted-foreground">{page.decision.acceptHelp}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" name="decision" value="ACCEPTED" size="sm">
                      {page.decision.accept}
                    </Button>
                    <Button type="submit" name="decision" value="REJECTED" size="sm" variant="outline">
                      {page.decision.reject}
                    </Button>
                    <Button type="submit" name="decision" value="SUPPORT_REQUESTED" size="sm" variant="ghost">
                      {page.decision.askSupport}
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="text-muted-foreground">
                  {finding.status === 'ACCEPTED'
                    ? page.decision.accepted
                    : finding.status === 'REJECTED'
                      ? page.decision.rejected
                      : finding.status === 'IN_REVIEW'
                        ? page.decision.waitingReview
                        : page.decision.waitingSubmit}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
