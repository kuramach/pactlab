import { CRITICAL_RATING_LABELS, type CriticalRating, type CriticalStructure } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { StructureFields, type CriticalMetricOption } from '../../../_lib/criticals/fields';
import { apiGet } from '../../_lib/api';
import { AskSellerButton } from '../../_lib/ask-seller';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addPactCritical, clearOverride, confirmPactCritical, evaluateCriticals, overrideStandard, promoteCritical } from './actions';

interface Figure {
  period: string | null;
  display: string | null;
  outcome: 'MET' | 'BORDERLINE' | 'MISSED' | 'MISSING';
  source: 'CALCULATED' | 'DOCUMENT';
  citation: { documentId: string; documentName: string | null; pageNumber: number; quote: string } | null;
}
interface Row {
  key: string;
  origin: 'ORG' | 'PACT';
  words: string | null;
  version: number;
  state: 'PROPOSED' | 'CONFIRMED' | 'DISABLED' | 'RETIRED';
  structure: CriticalStructure | null;
  structureText: string | null;
  standard: { version: number; structureText: string | null } | null;
  override: { key: string; version: number; disabled: boolean; structureText: string | null; reason: string; at: string } | null;
  metric: { label: string; settles: string; requests: string } | null;
  evaluation: {
    rating: CriticalRating;
    rationale: string;
    missing: string | null;
    requests: string | null;
    policyBreach: boolean;
    findingId: string | null;
    figures: Figure[];
    formula: string | null;
    evidenceIds: string[];
    ratedVersion: number;
    ratedStructureText: string | null;
    olderVersion: boolean;
    stale: boolean;
    evaluatedAt: string;
  } | null;
}
interface Panel {
  rows: Row[];
  summary: { good: number; even: number; bad: number; noEvidence: number; policyBreaches: number; stale: boolean };
  vocabulary: CriticalMetricOption[];
  canEdit: boolean;
  canOverride: boolean;
  canPromote: boolean;
  engineVersion: string;
}

const OUTCOMES: Record<string, string> = {
  'ok-evaluated': 'Rated against everything in the pact. Each rating shows its figures and where they come from.',
  'ok-evaluated-skipped': 'Rated, except criticals whose documents need AI to read them: AI is not available right now. Try again later.',
  'ok-proposed': 'Written for this pact. Check the proposed structure and confirm it; until then it rates nothing.',
  'ok-confirmed': 'Confirmed. Rate the pact to see how it stands.',
  'ok-overridden': 'Override recorded with its reason, next to the org standard it replaces. Rate the pact again to apply it.',
  'ok-cleared': 'Override removed: this pact is back on the org standard.',
  'ok-promoted': 'Now an org critical: it rates every future pact of this type.',
  'structure-invalid': 'That structure cannot evaluate here: pick a metric this pact’s type can evidence, and a lookback only for year-by-year metrics.',
  'override-metric': 'An override changes the threshold, lookback or band; it keeps the standard’s metric.',
  admin: 'Only an organization owner or admin adds criticals to the library.',
  'not-confirmed': 'Confirm the critical before making it an org critical.',
  threshold: 'Enter the threshold as a number (6 for 6%).',
};
const TONE = { GOOD: 'reviewed', EVEN: 'draft', BAD: 'danger', NO_EVIDENCE: 'evidence' } as const;
const OUTCOME_LABEL = { MET: 'met', BORDERLINE: 'borderline', MISSED: 'missed', MISSING: 'not in the pact' } as const;
const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';

/**
 * Deal Criticals (T-179): the organization's red lines on this pact. One row per critical, grouped by origin, with
 * the words, the confirmed threshold, the rating and its receipts. Buyer-confidential: the seller never sees this page.
 */
export default async function CriticalsPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<Panel>(`/v1/deals/${dealId}/criticals`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const panel = result.data;
  const org = panel.rows.filter((row) => row.origin === 'ORG');
  const pact = panel.rows.filter((row) => row.origin === 'PACT');

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          {panel.summary.good} good · {panel.summary.even} even · {panel.summary.bad} bad · {panel.summary.noEvidence} no evidence
          {panel.summary.policyBreaches > 0 ? (
            <>
              {' '}
              · <strong className="text-red-800">{panel.summary.policyBreaches} policy breach{panel.summary.policyBreaches === 1 ? '' : 'es'}</strong>
            </>
          ) : null}
          . Ratings are deterministic ({panel.engineVersion}); a person decides what follows.
        </p>
        {panel.canEdit ? (
          <form action={evaluateCriticals.bind(null, dealId)}>
            <Button type="submit" size="sm" variant={panel.summary.stale ? 'default' : 'outline'}>
              {panel.summary.stale ? 'Rate again (evidence or policy changed)' : 'Rate the pact'}
            </Button>
          </form>
        ) : null}
      </div>

      <Group title="Org standard" description="Your organization’s red lines for this type of pact. An override for this deal is shown next to the standard it replaces.">
        {org.length === 0 ? (
          <p className="text-muted-foreground">
            No org criticals for this type yet. An owner or admin writes them in <Link className="underline" href="/settings/criticals">Settings → Deal criticals</Link>.
          </p>
        ) : null}
        {org.map((row) => (
          <CriticalRow key={row.key} dealId={dealId} row={row} panel={panel} />
        ))}
      </Group>

      <Group title="This pact" description="Red lines for this deal alone. They never apply to another pact unless you make one an org critical.">
        {pact.map((row) => (
          <CriticalRow key={row.key} dealId={dealId} row={row} panel={panel} />
        ))}
        {panel.canEdit ? (
          <form action={addPactCritical.bind(null, dealId)} className="flex flex-wrap items-end gap-2">
            <label className="flex grow flex-col gap-1">
              <span className="text-xs text-muted-foreground">A critical for this pact, in your words</span>
              <input name="words" required minLength={3} maxLength={500} placeholder="e.g. Anchor-tenant lease has at least 5 years remaining" className={inputClass} />
            </label>
            <Button type="submit" size="sm" variant="outline">
              Propose the structure
            </Button>
          </form>
        ) : null}
      </Group>
    </div>
  );
}

function CriticalRow({ dealId, row, panel }: { dealId: string; row: Row; panel: Panel }) {
  const evaluation = row.evaluation;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.words ?? row.structureText}</span>
        {evaluation ? <Badge variant={TONE[evaluation.rating]}>{CRITICAL_RATING_LABELS[evaluation.rating]}</Badge> : null}
        {evaluation?.policyBreach ? <Badge variant="danger">Policy breach</Badge> : null}
        {row.state === 'PROPOSED' ? <Badge variant="draft">Not confirmed: rates nothing</Badge> : null}
        {row.state === 'DISABLED' ? <Badge variant="draft">Switched off for this pact</Badge> : null}
        {evaluation?.stale ? <Badge variant="draft">Stale: new evidence since rating</Badge> : null}
        {evaluation?.olderVersion ? <Badge variant="draft">Rated under v{evaluation.ratedVersion} of the policy</Badge> : null}
      </div>
      <p className="text-muted-foreground">
        {row.override ? (
          <>
            Org standard: {row.standard?.structureText} — this pact: <strong>{row.override.disabled ? 'switched off' : row.override.structureText}</strong> (override, reason recorded: “{row.override.reason}”)
          </>
        ) : row.structureText ? (
          <>
            Confirmed threshold: <strong>{row.structureText}</strong>
          </>
        ) : (
          'No structured form yet.'
        )}
      </p>
      {evaluation ? (
        <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2">
          <p>{evaluation.rationale}</p>
          {evaluation.figures.length > 0 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {evaluation.figures.map((figure, index) => (
                <li key={index} className="tabular-nums">
                  {figure.period ?? (figure.source === 'DOCUMENT' ? 'Stated' : 'Figure')}: <strong>{figure.display ?? '—'}</strong> <span className="text-muted-foreground">({OUTCOME_LABEL[figure.outcome]})</span>
                  {figure.citation ? (
                    <>
                      {' '}
                      <Link className="underline" href={`/deals/${dealId}/documents?documentId=${figure.citation.documentId}&page=${figure.citation.pageNumber}`}>
                        {figure.citation.documentName ?? 'Document'} p.{figure.citation.pageNumber}
                      </Link>
                      : “{figure.citation.quote}”
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {evaluation.formula ? (
            <p className="text-xs text-muted-foreground">
              <Badge variant="calculation">calculated</Badge> {evaluation.formula}
            </p>
          ) : null}
          <p className="flex flex-wrap gap-3 text-xs">
            {evaluation.evidenceIds.slice(0, 3).map((id, index) => (
              <Link key={id} className="underline" href={`/deals/${dealId}/evidence/${id}`}>
                Source row {index + 1}
              </Link>
            ))}
            {evaluation.evidenceIds.length > 3 ? <span className="text-muted-foreground">and {evaluation.evidenceIds.length - 3} more rows</span> : null}
            {evaluation.findingId ? (
              <Link className="underline" href={`/deals/${dealId}/findings/${evaluation.findingId}`}>
                The finding it raised
              </Link>
            ) : null}
          </p>
          {evaluation.missing ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                <strong>What would settle it:</strong> {evaluation.missing}
              </span>
              {evaluation.requests && panel.canEdit ? <AskSellerButton dealId={dealId} items={[evaluation.requests]} note={`For our review: ${evaluation.missing}`} label="Ask the seller for it" /> : null}
            </div>
          ) : null}
        </div>
      ) : row.state === 'CONFIRMED' ? (
        <p className="text-xs text-muted-foreground">Not rated yet.</p>
      ) : null}
      {row.origin === 'PACT' && row.state === 'PROPOSED' && panel.canEdit ? (
        <form action={confirmPactCritical.bind(null, dealId, row.key, row.version)} className="flex flex-col gap-2">
          <StructureFields metrics={panel.vocabulary} value={row.structure} />
          <Button type="submit" size="sm" className="w-fit">
            Confirm this structure
          </Button>
        </form>
      ) : null}
      {row.origin === 'PACT' && row.state === 'CONFIRMED' && panel.canPromote ? (
        <form action={promoteCritical.bind(null, dealId, row.key)}>
          <Button type="submit" size="sm" variant="ghost">
            Make this an org critical
          </Button>
        </form>
      ) : null}
      {row.origin === 'ORG' && panel.canOverride ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Override for this pact (reason required)</summary>
          <form action={overrideStandard.bind(null, dealId, row.key)} className="mt-2 flex flex-col gap-2">
            <StructureFields metrics={panel.vocabulary} value={row.structure ?? null} lockMetric />
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" name="mode" value="off" /> Switch it off for this pact
              </label>
              <input name="reason" required minLength={3} maxLength={500} placeholder="Why this pact differs" aria-label="Reason" className={`${inputClass} w-80`} />
              <Button type="submit" size="sm" variant="outline">
                Record the override
              </Button>
            </div>
          </form>
          {row.override ? (
            <form action={clearOverride.bind(null, dealId, row.override.key, row.override.version)} className="mt-2">
              <Button type="submit" size="sm" variant="ghost">
                Back to the org standard
              </Button>
            </form>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function Group({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}
