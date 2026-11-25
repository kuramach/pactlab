import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@pactlab/ui';
import { RoutingFlow } from '../../../_components/ai-routing/routing-flow';
import type { ModelChoice, RoutingView } from '../../../_components/ai-routing/routing-graph';
import { apiGet } from '../../deals/_lib/api';
import { ApiState } from '../../deals/_lib/states';
import { setOrganizationRoute } from './actions';

const OUTCOMES: Record<string, string> = {
  ok: 'Saved. New AI work uses it within a minute.',
  NOT_ALLOWED: 'That model is not approved for your organization. Ask Pactlab to evaluate or allow it.',
  forbidden: 'Only your organization’s owners and administrators can change this.',
  invalid: 'That choice could not be saved.',
};

/** Settings → AI models (Kumar, 2026-11-19): this organization's routing diagram; owners and admins choose models. */
export default async function AiModelsSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<{ enabled: boolean; canEdit: boolean; choices: ModelChoice[]; routing: RoutingView | null }>('/v1/ai/routing');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/settings', label: 'Settings' }, { label: 'AI models' }]}
        title="AI models"
        description="How your organization’s AI work is routed, job by job. Every result stays a draft with citations until a person accepts it."
      />
      {typeof outcome === 'string' && OUTCOMES[outcome] ? (
        <p role="status" className="rounded-xl border px-3 py-2 text-sm">
          {OUTCOMES[outcome]}
        </p>
      ) : null}
      <Card section="ai-models">
        <CardHeader>
          <CardTitle>Routing</CardTitle>
          <CardDescription>
            Each job uses the first model in its chain that can serve, then falls back. You can choose only models Pactlab has evaluated and approved for your organization; anything
            you leave alone follows Pactlab’s default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.kind !== 'ok' ? (
            <ApiState result={result} />
          ) : result.data.routing ? (
            <RoutingFlow view={result.data.routing} choices={result.data.choices} editable={result.data.canEdit} save={setOrganizationRoute} rolesClearable />
          ) : (
            <p className="text-sm text-muted-foreground">AI is off in this environment.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
