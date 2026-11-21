import type { Page } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet } from '../(app)/deals/_lib/api';
import { RoutingFlow } from '../_components/ai-routing/routing-flow';
import type { ModelChoice, RoutingView } from '../_components/ai-routing/routing-graph';
import { ApiState } from '../(app)/deals/_lib/states';
import { addModel, evaluateModel, retireModel, setOrganizationModels, setPlatformRoute, setProviderTerms } from './ai-model-actions';

type Alias = 'fast' | 'balanced' | 'deep_review' | 'contract_scrub' | 'extraction' | 'classification' | 'document_qa' | 'vision';
interface Model {
  id: string;
  provider: string;
  providerModelId: string;
  label: string;
  status: 'ADDED' | 'EVALUATED' | 'RETIRED';
  evaluation: {
    passed?: boolean;
    goldenPassed?: number;
    goldenTotal?: number;
    probesBlocked?: number;
    probesTotal?: number;
    citationRecall?: number;
    citationPrecision?: number;
    ranAt?: string;
    failures?: string[];
    basis?: string;
    /** 'health': the quick health check (2026-11-20). */
    kind?: 'health';
    latencyMs?: number;
  } | null;
  evaluatingSince: string | null;
  /** A prompt changed since its evaluation: it still serves; evaluate it again. */
  reevaluationDue: boolean;
  organizations: number;
  platformAliases: Alias[];
}
interface Terms {
  provider: 'anthropic' | 'openai' | 'google';
  dpaInPlace: boolean;
  zeroRetention: boolean;
  region: string | null;
  notes: string | null;
  recordedAt: string;
  recordedByName: string | null;
  cleared: boolean;
}
interface Catalog {
  terms: Terms[];
  providers: string[];
  aiOn: boolean;
  models: Model[];
}

const ROLES: { alias: Alias; label: string; help: string }[] = [
  { alias: 'fast', label: 'Fast', help: 'classification and quick reads' },
  { alias: 'balanced', label: 'Balanced', help: 'extraction, questions, most work' },
  { alias: 'deep_review', label: 'Deep review', help: 'contracts, valuation and Foresight' },
];
/**
 * Best-of-breed routing (T-132): a model per job type. Unset, the job follows its registry chain (e.g.
 * extraction: Gemini Pro when connected and evaluated, else the Balanced Claude model).
 */
const JOBS: { alias: Alias; label: string; help: string }[] = [
  { alias: 'deep_review', label: 'Deep review (job)', help: 'agreement findings judgment' },
  { alias: 'contract_scrub', label: 'Consistency checks', help: 'defined terms, cross-references, party names' },
  { alias: 'extraction', label: 'Extraction', help: 'contract fields, financial lines' },
  { alias: 'classification', label: 'Classification', help: 'document types and triage' },
  { alias: 'document_qa', label: 'Questions and drafting', help: 'document Q&A, Foresight, briefs' },
  { alias: 'vision', label: 'Image documents', help: 'scans, charts, image tables' },
];
const LABELS = new Map([...JOBS, ...[
  { alias: 'fast' as Alias, label: 'Fast' },
  { alias: 'balanced' as Alias, label: 'Balanced' },
  { alias: 'deep_review' as Alias, label: 'Deep review' },
]].map((entry) => [entry.alias, entry.label]));
const PROVIDERS: Record<string, string> = { bedrock: 'Claude on AWS Bedrock', anthropic: 'Claude via the Anthropic API', openai: 'OpenAI', google: 'Google', fixture: 'Synthetic (tests)' };
const STATUS: Record<Model['status'], { label: string; variant: 'calculation' | 'draft' | 'neutral' }> = {
  EVALUATED: { label: 'Evaluated: can serve', variant: 'calculation' },
  ADDED: { label: 'Not evaluated', variant: 'draft' },
  RETIRED: { label: 'Retired', variant: 'neutral' },
};
const pct = (value: number | undefined) => (value === undefined ? '—' : `${Math.round(value * 100)}%`);
const field = 'rounded-md border border-border bg-background px-2 py-1.5 text-sm';

function Evaluation({ model }: { model: Model }) {
  if (model.evaluatingSince) return <span className="text-xs text-muted-foreground">Checking since {model.evaluatingSince.slice(11, 16)} UTC… refresh in a moment.</span>;
  const result = model.evaluation;
  if (!result) return <span className="text-xs text-muted-foreground">Not run yet</span>;
  if (result.basis) return <span className="text-xs text-muted-foreground">{result.basis}</span>;
  if (result.kind === 'health') {
    return (
      <span className="flex flex-col gap-0.5 text-xs">
        <span>
          <Badge variant={result.passed ? 'calculation' : 'danger'}>{result.passed ? 'Healthy' : 'Not working'}</Badge>{' '}
          {result.passed ? `answered with a valid cited answer in ${((result.latencyMs ?? 0) / 1000).toFixed(1)} s` : (result.failures?.[0] ?? 'the check failed')}
        </span>
        <span className="text-muted-foreground">Checked {result.ranAt?.slice(0, 16).replace('T', ' ')} UTC</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5 text-xs">
      <span>
        <Badge variant={result.passed ? 'calculation' : 'danger'}>{result.passed ? 'Passed' : 'Failed'}</Badge> golden {result.goldenPassed}/{result.goldenTotal} · probes blocked {result.probesBlocked}/{result.probesTotal} · citations {pct(result.citationRecall)} recall, {pct(result.citationPrecision)} precision
      </span>
      <span className="text-muted-foreground">Ran {result.ranAt?.slice(0, 16).replace('T', ' ')} UTC</span>
      {result.failures?.length ? <span className="text-rose-700">{result.failures.slice(0, 3).join(' · ')}</span> : null}
    </span>
  );
}

/**
 * AI models (T-131): which models pacts may use, managed here instead of in code. A model is added,
 * evaluated against the synthetic golden set and injection probes, and only then can serve, as a
 * platform default per role or for chosen organizations. Every change is audited.
 */
export async function AiModels({ organizationId, organizationQuery }: { organizationId: string; organizationQuery: string }) {
  const result = await apiGet<Catalog>('/v1/admin/ai-models');
  const routing = await apiGet<{ enabled: boolean; choices: ModelChoice[]; routing: RoutingView | null }>('/v1/admin/ai-models/routing');
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const { models, providers, aiOn, terms } = result.data;
  const evaluated = models.filter((model) => model.status === 'EVALUATED');
  const organizations = organizationQuery ? await apiGet<Page<{ id: string; name: string; slug: string }>>(`/v1/admin/organizations?q=${encodeURIComponent(organizationQuery)}&limit=20`) : null;
  const chosen = organizationId ? await apiGet<{ allowed: string[]; routes: Partial<Record<Alias, string>> }>(`/v1/admin/ai-models/organizations/${organizationId}`) : null;

  return (
    <div className="flex flex-col gap-4">
      {!aiOn ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          AI is off in this environment, so models can be listed but not evaluated.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform defaults: how AI work is routed</CardTitle>
          <CardDescription>
            Every organization without its own choice uses these. Material flows left to right; click a job or a Claude role to choose its model. Evaluated models only; applies within
            a minute. Organizations’ owners and admins can choose their own in Settings → AI models, from the models allowed for them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {routing.kind === 'ok' && routing.data.routing ? (
            <RoutingFlow view={routing.data.routing} choices={routing.data.choices} editable save={setPlatformRoute} rolesClearable={false} />
          ) : routing.kind === 'ok' ? (
            <p className="text-sm text-muted-foreground">AI is off in this environment, so there is nothing to route.</p>
          ) : (
            <ApiState result={routing} />
          )}
        </CardContent>
      </Card>

      {/* The catalog is for adding a model or running a health check; the diagram above is where models are chosen. */}
      <details className="group rounded-xl border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Model catalog and data terms (advanced)</summary>
        <div className="flex flex-col gap-4 p-4 pt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Models</CardTitle>
              <CardDescription>
                The models configured for this environment serve as soon as it is deployed. A model added here serves once its health check passes: one synthetic question, which it
                must answer with a valid, cited answer. Only synthetic material is sent; never deal data.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 overflow-x-auto p-0">
              <table className="w-full text-left text-sm" aria-label="AI models">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Evaluation</th>
                    <th className="px-3 py-2">Used</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {models.map((model) => (
                    <tr key={model.id}>
                      <td className="px-3 py-2 align-top">
                        <span className="font-semibold">{model.label}</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {PROVIDERS[model.provider] ?? model.provider} · {model.providerModelId}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {/* A failed evaluation leaves the model not serving (2026-11-20): say so, never "Not evaluated". */}
                        {model.status === 'ADDED' && model.evaluation?.passed === false ? (
                          <Badge variant="danger">Not serving</Badge>
                        ) : (
                          <Badge variant={STATUS[model.status].variant}>{STATUS[model.status].label}</Badge>
                        )}
                        {model.reevaluationDue ? (
                          <span className="mt-1 block">
                            <Badge variant="draft">Re-evaluation due</Badge>
                            <span className="block text-xs text-muted-foreground">Prompts changed since its evaluation.</span>
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Evaluation model={model} />
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {model.platformAliases.length ? `Default for ${model.platformAliases.map((alias) => LABELS.get(alias) ?? alias).join(', ')}` : '—'}
                        {model.organizations ? <span className="block text-muted-foreground">{model.organizations} organization{model.organizations === 1 ? '' : 's'}</span> : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {model.status !== 'RETIRED' ? (
                          <span className="flex flex-wrap gap-1">
                            {aiOn && !model.evaluatingSince ? (
                              <form action={evaluateModel.bind(null, model.id)}>
                                <Button type="submit" size="sm" variant="outline">
                                  {model.evaluation && !model.evaluation.basis ? 'Check again' : 'Run health check'}
                                </Button>
                              </form>
                            ) : null}
                            {model.platformAliases.length === 0 ? (
                              <form action={retireModel.bind(null, model.id)}>
                                <Button type="submit" size="sm" variant="ghost">
                                  Retire
                                </Button>
                              </form>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form action={addModel} className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-3 text-sm" aria-label="Add a model">
                <label className="flex flex-col gap-1 font-medium">
                  Provider
                  <select name="provider" className={field} required>
                    {providers.map((provider) => (
                      <option key={provider} value={provider}>
                        {PROVIDERS[provider] ?? provider}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 font-medium">
                  Model ID
                  <input name="providerModelId" required maxLength={200} placeholder="us.anthropic.claude-opus-5-5" className={`${field} w-72 font-mono`} />
                </label>
                <label className="flex flex-col gap-1 font-medium">
                  Name
                  <input name="label" required maxLength={80} placeholder="Claude Opus 5.5" className={`${field} w-48`} />
                </label>
                <Button type="submit" size="sm">
                  Add model
                </Button>
                <span className="text-xs text-muted-foreground">OpenAI and Google appear here once their key is set (scripts/ai-key.sh).</span>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Other clouds: data terms</CardTitle>
              <CardDescription>
                OpenAI and Google run outside our AWS accounts. Their models can be evaluated and serve only with a data-processing agreement in place and zero retention (no
                storing or training on our requests) on record. Untick either and their models stop at once. Deal content still never includes people data.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {(['anthropic', 'openai', 'google'] as const).map((provider) => {
                const current = terms.find((entry) => entry.provider === provider);
                return (
                  <form key={provider} action={setProviderTerms.bind(null, provider)} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm" aria-label={`${PROVIDERS[provider]} data terms`}>
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {PROVIDERS[provider]}
                      <Badge variant={providers.includes(provider) ? 'calculation' : 'neutral'}>{providers.includes(provider) ? 'Key set' : 'No key'}</Badge>
                      <Badge variant={current?.cleared ? 'calculation' : 'draft'}>{current?.cleared ? 'Cleared to serve' : 'Not cleared'}</Badge>
                    </span>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="dpaInPlace" defaultChecked={current?.dpaInPlace ?? false} /> Data-processing agreement in place
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="zeroRetention" defaultChecked={current?.zeroRetention ?? false} /> Zero retention: no storing or training on our requests
                    </label>
                    <label className="flex flex-col gap-1 font-medium">
                      Region
                      <input name="region" defaultValue={current?.region ?? ''} maxLength={80} placeholder="e.g. US" className={field} />
                    </label>
                    <label className="flex flex-col gap-1 font-medium">
                      Notes (agreement reference, date)
                      <input name="notes" defaultValue={current?.notes ?? ''} maxLength={1000} className={field} />
                    </label>
                    {current ? (
                      <span className="text-xs text-muted-foreground">
                        Recorded {current.recordedAt.slice(0, 10)}
                        {current.recordedByName ? ` by ${current.recordedByName}` : ''}
                      </span>
                    ) : null}
                    <Button type="submit" size="sm" variant="outline" className="self-start">
                      Save terms
                    </Button>
                  </form>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </details>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">For one organization</CardTitle>
          <CardDescription>
            Limit an organization to chosen models, and pick its model per role. With nothing ticked it uses the platform defaults. With models ticked, any role whose model is not on
            its list is refused rather than sent to another model.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <form method="get" className="flex flex-wrap items-end gap-2" role="search">
            <input type="hidden" name="tab" value="models" />
            <label className="flex flex-col gap-1 font-medium">
              Find an organization
              <input name="aiq" defaultValue={organizationQuery} maxLength={120} placeholder="Name or slug" className={`${field} w-72`} />
            </label>
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </form>
          {organizations?.kind === 'ok' ? (
            <ul className="flex flex-wrap gap-2" aria-label="Matching organizations">
              {organizations.data.items.map((org) => (
                <li key={org.id}>
                  <a href={`/admin?tab=models&aiq=${encodeURIComponent(organizationQuery)}&aiorg=${org.id}`} className={`rounded-full border px-3 py-1 ${org.id === organizationId ? 'border-indigo-ink bg-muted font-semibold' : 'border-border'}`}>
                    {org.name}
                  </a>
                </li>
              ))}
              {organizations.data.items.length === 0 ? <li className="text-muted-foreground">No organization matches.</li> : null}
            </ul>
          ) : null}
          {chosen?.kind === 'ok' ? (
            <form action={setOrganizationModels.bind(null, organizationId)} className="flex flex-col gap-3 rounded-lg border border-border p-3" aria-label="This organization's models">
              <fieldset className="flex flex-col gap-1">
                <legend className="font-medium">Allowed models</legend>
                {evaluated.map((model) => (
                  <label key={model.id} className="flex items-center gap-2">
                    <input type="checkbox" name="allowed" value={model.id} defaultChecked={chosen.data.allowed.includes(model.id)} /> {model.label}{' '}
                    <span className="font-mono text-xs text-muted-foreground">{PROVIDERS[model.provider] ?? model.provider}</span>
                  </label>
                ))}
              </fieldset>
              <div className="grid gap-3 md:grid-cols-3">
                {[...ROLES, ...JOBS.filter((job) => job.alias !== 'deep_review')].map((role) => (
                  <label key={role.alias} className="flex flex-col gap-1 font-medium">
                    {role.label}
                    <select name={`route-${role.alias}`} defaultValue={chosen.data.routes[role.alias] ?? ''} className={field}>
                      <option value="">Platform default</option>
                      {evaluated.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <Button type="submit" size="sm" className="self-start">
                Save for this organization
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
