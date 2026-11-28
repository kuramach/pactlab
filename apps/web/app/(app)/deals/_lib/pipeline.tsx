import { AiMark, Badge, Card, CardContent, CardHeader, CardTitle, HumanMark } from '@pactlab/ui';
import Link from 'next/link';
import { EN, type I18n } from '../../../../lib/i18n';

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
export function pipelineSteps(dealId: string, counts: PipelineCounts, t: I18n = EN): PipelineStep[] {
  const base = `/deals/${dealId}`;
  const words = t.m.home.pipeline;
  return [
    {
      key: 'documents',
      label: words.steps.documents,
      detail: counts.documents === 0 ? words.noDocuments : t.plural(counts.documents, words.documents),
      state: counts.documents > 0 ? 'done' : 'next',
      href: `${base}/documents`,
    },
    {
      key: 'review',
      label: words.steps.review,
      detail: counts.drafts > 0 ? t.plural(counts.drafts, words.drafts) : counts.documents > 0 ? words.nothingWaiting : words.afterDocuments,
      state: counts.drafts > 0 ? 'waiting' : counts.documents > 0 ? 'done' : 'next',
      href: `${base}/documents`,
    },
    {
      key: 'findings',
      label: words.steps.findings,
      detail: t.fill(words.accepted, { count: t.number(counts.accepted) }),
      state: counts.accepted > 0 ? 'done' : 'next',
      href: `${base}/findings`,
    },
    {
      key: 'valuation',
      label: words.steps.valuation,
      detail: counts.scenarios === 0 ? words.noScenario : counts.staleScenarios > 0 ? t.plural(counts.staleScenarios, words.stale) : t.plural(counts.scenarios, words.current),
      state: counts.scenarios === 0 ? 'next' : counts.staleScenarios > 0 ? 'waiting' : 'done',
      href: `${base}/valuation`,
    },
  ];
}

const LOOK = { done: 'reviewed', waiting: 'draft', next: 'neutral' } as const;

export function PipelineCard({ steps, t = EN }: { steps: readonly PipelineStep[]; t?: I18n }) {
  const words = t.m.home.pipeline;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{words.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={words.title}>
          {steps.map((step, index) => (
            <li key={step.key}>
              <Link href={step.href} className="flex h-full flex-col gap-1 rounded-lg border border-border p-3 text-sm hover:bg-muted">
                <span className="flex items-center justify-between gap-2 font-semibold">
                  <span className="flex items-center gap-1.5">
                    {index + 1}. {step.label}
                    {/* Drafts come from the AI; acceptance is a person's call. */}
                    {step.key === 'review' ? <AiMark /> : step.key === 'findings' ? <HumanMark /> : null}
                  </span>
                  <Badge variant={LOOK[step.state]}>{words.states[step.state]}</Badge>
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
