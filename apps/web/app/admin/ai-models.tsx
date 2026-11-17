import type { Page } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet } from '../(app)/deals/_lib/api';
import { ApiState } from '../(app)/deals/_lib/states';
import { addModel, evaluateModel, retireModel, setOrganizationModels, setPlatformRoute } from './ai-model-actions';

type Alias = 'fast' | 'balanced' | 'deep_review';
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
  } | null;
  evaluatingSince: string | null;
  organizations: number;
  platformAliases: Alias[];
}
interface Catalog {
  providers: string[];
  aiOn: boolean;
  models: Model[];
}

const ROLES: { alias: Alias; label: string; help: string }[] = [
  { alias: 'fast', label: 'Fast', help: 'classification and quick reads' },
  { alias: 'balanced', label: 'Balanced', help: 'extraction, questions, most work' },
  { alias: 'deep_review', label: 'Deep review', help: 'contracts, valuation and Foresight' },
];
const PROVIDERS: Record<string, string> = { bedrock: 'Claude on AWS Bedrock', openai: 'OpenAI', google: 'Google', fixture: 'Synthetic (tests)' };
const STATUS: Record<Model['status'], { label: string; variant: 'calculation' | 'draft' | 'neutral' }> = {
  EVALUATED: { label: 'Evaluated: can serve', variant: 'calculation' },
  ADDED: { label: 'Not evaluated', variant: 'draft' },
  RETIRED: { label: 'Retired', variant: 'neutral' },
};
const pct = (value: number | undefined) => (value === undefined ? '—' : `${Math.round(value * 100)}%`);
const field = 'rounded-md border border-border bg-background px-2 py-1.5 text-sm';

function Evaluation({ model }: { model: Model }) {
  if (model.evaluatingSince) return <span className="text-xs text-muted-foreground">Evaluating since {model.evaluatingSince.slice(11, 16)} UTC… refresh in a few minutes.</span>;
  const result = model.evaluation;
  if (!result) return <span className="text-xs text-muted-foreground">Not run yet</span>;
  if (result.basis) return <span className="text-xs text-muted-foreground">{result.basis}</span>;
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
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const { models, providers, aiOn } = result.data;
  const evaluated = models.filter((model) => model.status === 'EVALUATED');
  const platform = (alias: Alias) => models.find((model) => model.platformAliases.includes(alias));
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
          <CardTitle className="text-base">Models</CardTitle>
          <CardDescription>
            A model serves pacts only once it has passed the evaluation: every golden case, every injection probe blocked, and citations at least 90% right. Only synthetic test
            material is sent; never deal data.
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
                    <Badge variant={STATUS[model.status].variant}>{STATUS[model.status].label}</Badge>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Evaluation model={model} />
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {model.platformAliases.length ? `Default for ${model.platformAliases.map((alias) => ROLES.find((role) => role.alias === alias)?.label).join(', ')}` : '—'}
                    {model.organizations ? <span className="block text-muted-foreground">{model.organizations} organization{model.organizations === 1 ? '' : 's'}</span> : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {model.status !== 'RETIRED' ? (
                      <span className="flex flex-wrap gap-1">
                        {aiOn && !model.evaluatingSince ? (
                          <form action={evaluateModel.bind(null, model.id)}>
                            <Button type="submit" size="sm" variant="outline">
                              {model.evaluation && !model.evaluation.basis ? 'Evaluate again' : 'Run evaluation'}
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
            <span className="text-xs text-muted-foreground">Other clouds (OpenAI, Google) appear here once their connections are set up.</span>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform defaults</CardTitle>
          <CardDescription>The model each role uses for every organization without its own choice. Evaluated models only; applies within a minute.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {ROLES.map((role) => (
            <form key={role.alias} action={setPlatformRoute.bind(null, role.alias)} className="flex flex-col gap-1 text-sm" aria-label={`Default for ${role.label}`}>
              <label className="flex flex-col gap-1 font-medium">
                {role.label} <span className="text-xs font-normal text-muted-foreground">{role.help}</span>
                <select name="modelId" defaultValue={platform(role.alias)?.id ?? ''} className={field}>
                  {evaluated.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" size="sm" variant="outline" className="self-start">
                Save
              </Button>
            </form>
          ))}
        </CardContent>
      </Card>

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
                {ROLES.map((role) => (
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
