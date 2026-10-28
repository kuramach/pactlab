import { Badge, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';

export interface PipelineCounts {
  documents: number;
  drafts: number;
  accepted: number;
  scenarios: number;
  staleScenarios: number;
}

export interface PipelineStep {
  key: string;
  label: string;
  detail: string;
  state: 'done' | 'waiting' | 'next';
  href: string;
}

/**
 * The pact's pipeline as it moves (T-094 B13): upload → AI drafts → review →
 * valuation. Upload starts extraction on its own, and an accepted finding
 * marks dependent scenarios stale, so this reads live state rather than
 * asking anyone to tick stations off.
 */
export function pipelineSteps(dealId: string, counts: PipelineCounts): PipelineStep[] {
  const base = `/deals/${dealId}`;
  return [
    {
      key: 'documents',
      label: 'Documents in',
      detail: counts.documents === 0 ? 'No documents yet' : `${counts.documents} document${counts.documents === 1 ? '' : 's'}; AI extraction starts on upload`,
      state: counts.documents > 0 ? 'done' : 'next',
      href: `${base}/documents`,
    },
    {
      key: 'review',
      label: 'Drafts reviewed',
      detail: counts.drafts > 0 ? `${counts.drafts} AI draft${counts.drafts === 1 ? '' : 's'} waiting for a person` : counts.documents > 0 ? 'Nothing waiting' : 'After documents',
      state: counts.drafts > 0 ? 'waiting' : counts.documents > 0 ? 'done' : 'next',
      href: `${base}/documents`,
    },
    {
      key: 'findings',
      label: 'Findings accepted',
      detail: `${counts.accepted} accepted`,
      state: counts.accepted > 0 ? 'done' : 'next',
      href: `${base}/findings`,
    },
    {
      key: 'valuation',
      label: 'Valuation current',
      detail:
        counts.scenarios === 0
          ? 'No scenario yet'
          : counts.staleScenarios > 0
            ? `${counts.staleScenarios} scenario${counts.staleScenarios === 1 ? '' : 's'} need a re-run after new findings`
            : `${counts.scenarios} scenario${counts.scenarios === 1 ? '' : 's'} up to date`,
      state: counts.scenarios === 0 ? 'next' : counts.staleScenarios > 0 ? 'waiting' : 'done',
      href: `${base}/valuation`,
    },
  ];
}

const LOOK = { done: { label: 'Done', variant: 'reviewed' }, waiting: { label: 'Needs you', variant: 'draft' }, next: { label: 'Next', variant: 'neutral' } } as const;

export function PipelineCard({ steps }: { steps: readonly PipelineStep[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Pipeline">
          {steps.map((step, index) => (
            <li key={step.key}>
              <Link href={step.href} className="flex h-full flex-col gap-1 rounded-lg border border-border p-3 text-sm hover:bg-muted">
                <span className="flex items-center justify-between gap-2 font-semibold">
                  {index + 1}. {step.label}
                  <Badge variant={LOOK[step.state].variant}>{LOOK[step.state].label}</Badge>
                </span>
                <span className="text-muted-foreground">{step.detail}</span>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
