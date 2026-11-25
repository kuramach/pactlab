import type { Page } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet } from '../(app)/deals/_lib/api';
import { RoutingFlow } from '../_components/ai-routing/routing-flow';
import type { ModelChoice, RoutingView } from '../_components/ai-routing/routing-graph';
import { ApiState } from '../(app)/deals/_lib/states';
import { evaluateModel, retireModel, setOrganizationModels, setPlatformRoute, setProviderTerms, useBedrockModel } from './ai-model-actions';

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
const field = 'rounded-md border border-border bg-background px-2 py-1.5 text-sm';

const MAKERS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', meta: 'Meta', mistral: 'Mistral AI', amazon: 'Amazon', cohere: 'Cohere', deepseek: 'DeepSeek', ai21: 'AI21 Labs', qwen: 'Qwen', writer: 'Writer', nvidia: 'NVIDIA' };
/** Who makes a model, from its id (`us.anthropic.claude-…` → Anthropic); direct providers by name. */
const makerOf = (model: Pick<Model, 'provider' | 'providerModelId'>) => {
  if (model.provider === 'fixture') return 'Synthetic (tests)';
  if (model.provider !== 'bedrock') return PROVIDERS[model.provider] ?? model.provider;
  const family = model.providerModelId.replace(/^(?:us|eu|apac|global|us-gov)\./, '').split('.')[0] ?? '';
  return MAKERS[family] ?? family;
};
const ROLE_NAMES: Record<string, string> = { fast: 'Fast', balanced: 'Balanced', deep_review: 'Deep review' };

/** Models in use (2026-11-21): name, maker, ready or not, where it's used; Remove for an unused one. No scores. */
export function ModelsInUse({ models }: { models: Model[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Models in use</CardTitle>
        <CardDescription>Choose where each one serves in the diagram above. Add more from Bedrock below.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border" aria-label="Models in use">
          {models.map((model) => {
            const checking = model.evaluatingSince !== null || (model.status === 'ADDED' && !model.evaluation);
            const failed = !checking && model.status === 'ADDED';
            const used = model.platformAliases.map((alias) => ROLE_NAMES[alias] ?? LABELS.get(alias) ?? alias);
            return (
              <li key={model.id} className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${checking ? 'bg-amber-400' : failed ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{model.label}</span> <span className="text-muted-foreground">· {makerOf(model)}</span>
                  <span className="block text-xs text-muted-foreground" title={failed ? (model.evaluation?.failures?.[0] ?? '') : undefined}>
                    {checking ? 'Checking…' : failed ? `Not working: ${model.evaluation?.failures?.[0] ?? 'the health check failed'}` : used.length ? `Default for ${used.join(', ')}` : 'Ready'}
                  </span>
                </span>
                {failed ? (
                  <form action={evaluateModel.bind(null, model.id)}>
                    <Button type="submit" size="sm" variant="outline">
                      Check again
                    </Button>
                  </form>
                ) : null}
                {used.length === 0 ? (
                  <form action={retireModel.bind(null, model.id)}>
                    <Button type="submit" size="sm" variant="ghost">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

interface BedrockModel {
  modelId: string;
  maker: string;
  name: string;
  readsImages: boolean;
}
interface ScorecardPickView {
  name: string;
  score: string | null;
  costPerTask: string | null;
  role: 'primary' | 'fallback' | 'evaluate';
  note?: string;
  inUse: { id: string; ready: boolean } | null;
  bedrockModelId: string | null;
}
interface ScorecardJobView {
  job: string;
  label: string;
  board: string;
  verdict: string;
  picks: ScorecardPickView[];
}

const ROLE_TEXT: Record<ScorecardPickView['role'], string> = { primary: 'Primary', fallback: 'Fallback', evaluate: 'Try next' };

/**
 * Choosing models (2026-11-21): the model scorecard's picks per job (docs/model-scorecard.md; public scores are
 * priors, never verdicts), each with its board score and cost per task, and one click to use it if this
 * account's Bedrock has it. Every other Bedrock model is below, by maker.
 */
async function AddFromBedrock() {
  const result = await apiGet<{ connected: boolean; scorecard: { asOf: string; source: string; jobs: ScorecardJobView[] }; items: BedrockModel[] }>('/v1/admin/ai-models/bedrock');
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const { connected, scorecard, items } = result.data;
  const byMaker = new Map<string, BedrockModel[]>();
  for (const model of items) byMaker.set(model.maker, [...(byMaker.get(model.maker) ?? []), model]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recommended models by job</CardTitle>
        <CardDescription>
          From the model scorecard ({scorecard.asOf}): public benchmark scores per job, then cost per task. Scores rank what to try; a model serves only once Pactlab can reach it and
          its check passes. Pick where each serves in the diagram above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {!connected ? <p className="text-muted-foreground">This environment does not use Bedrock, so models cannot be added here.</p> : null}
        {scorecard.jobs.map((job) => (
          <section key={job.job} aria-label={job.label} className="flex flex-col gap-1">
            <h3 className="font-semibold">{job.label}</h3>
            <p className="text-xs text-muted-foreground">
              {job.verdict} <span className="italic">{job.board}</span>
            </p>
            <ul className="divide-y divide-border rounded-lg border">
              {job.picks.map((pick) => (
                <li key={pick.name} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="w-20 text-xs uppercase tracking-wide text-slate-text">{ROLE_TEXT[pick.role]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{pick.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[pick.score ? `score ${pick.score}` : 'no public score', pick.costPerTask ? `${pick.costPerTask} per task` : null, pick.note].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {pick.inUse ? (
                    <span className="text-xs font-medium text-emerald-700">{pick.inUse.ready ? '✓ In use' : 'Checking…'}</span>
                  ) : pick.bedrockModelId ? (
                    <form action={useBedrockModel.bind(null, pick.bedrockModelId)}>
                      <Button type="submit" size="sm" variant="outline">
                        Use
                      </Button>
                    </form>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not on your Bedrock</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {byMaker.size > 0 ? (
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 font-medium">Other models on your Bedrock ({items.length})</summary>
            <div className="flex flex-col gap-3 p-3 pt-0">
              {[...byMaker.entries()].map(([maker, models]) => (
                <div key={maker}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-text">{maker}</p>
                  <ul className="divide-y divide-border">
                    {models.map((model) => (
                      <li key={model.modelId} className="flex items-center gap-3 py-1.5">
                        <span className="min-w-0 flex-1">
                          {model.name}
                          {model.readsImages ? <span className="ml-2 text-xs text-muted-foreground">reads images</span> : null}
                        </span>
                        <form action={useBedrockModel.bind(null, model.modelId)}>
                          <Button type="submit" size="sm" variant="ghost">
                            Use
                          </Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
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

      <ModelsInUse models={models.filter((model) => model.status !== 'RETIRED')} />

      <AddFromBedrock />

      {/* Data terms matter only for providers outside AWS; they show only when one of their keys is set. */}
      {providers.some((provider) => provider === 'anthropic' || provider === 'openai' || provider === 'google') ? (
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
      ) : null}

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
