import { COMPANY_TYPE_LABELS, COMPANY_TYPES, type CompanyType, type CriticalStructure } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@pactlab/ui';
import { keepParams, Pager, pageApiQuery, pagerLinks, readPage } from '../../../_components/pager';
import { StructureFields, type CriticalMetricOption } from '../../_lib/criticals/fields';
import { apiGet } from '../../deals/_lib/api';
import { OutcomeBanner } from '../../deals/_lib/outcome';
import { ApiState } from '../../deals/_lib/states';
import { confirmStandard, createStandard, retireStandard, reviseStandard } from './actions';

interface CriticalView {
  key: string;
  version: number;
  companyType: CompanyType | null;
  words: string | null;
  structure: CriticalStructure | null;
  structureText: string | null;
  structureSource: 'AI' | 'PERSON' | null;
  state: 'PROPOSED' | 'CONFIRMED' | 'DISABLED' | 'RETIRED';
  evaluates: boolean;
  problem: string | null;
  promotedFromKey: string | null;
  updatedAt: string;
}
interface Library {
  items: CriticalView[];
  nextCursor: string | null;
  total: number;
  limit: number;
  canEdit: boolean;
}

const OUTCOMES: Record<string, string> = {
  'ok-proposed': 'Written. Check the structure Pactlab proposed from your words and confirm it: until then the critical evaluates nothing.',
  'ok-confirmed': 'Confirmed. This structure is what every pact of the type is rated on; past ratings keep the version they ran under.',
  'ok-revised': 'A new version, proposed again. Confirm its structure to put it into effect.',
  'ok-retired': 'Retired from the library. Pacts already rated keep their ratings.',
  'structure-invalid': 'That structure cannot evaluate: the metric must be one this company type can evidence, and only year-by-year metrics take a lookback.',
  threshold: 'Enter the threshold as a number (6 for 6%).',
};
const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';

/**
 * Settings → Deal criticals (T-179): the organization's red lines, written once in its own words, confirmed in
 * structured form and rated on every pact of the type. Buyer-confidential: sellers never see them.
 */
export default async function CriticalsLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const typeFilter = typeof search['type'] === 'string' && ([...COMPANY_TYPES, 'ALL'] as readonly string[]).includes(search['type']) ? search['type'] : undefined;
  const position = readPage(search);
  const query = [pageApiQuery(position), typeFilter ? `companyType=${typeFilter}` : ''].filter(Boolean).join('&');
  const [result, vocabulary] = await Promise.all([apiGet<Library>(`/v1/criticals${query ? `?${query}` : ''}`), apiGet<{ items: CriticalMetricOption[] }>('/v1/criticals/metrics?companyType=MULTIFAMILY')]);
  const crumbs = [{ href: '/', label: 'Home' }, { href: '/settings', label: 'Settings' }, { label: 'Deal criticals' }];
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const library = result.data;
  const metricsFor = async (type: CompanyType | null) => {
    const found = await apiGet<{ items: CriticalMetricOption[] }>(`/v1/criticals/metrics?companyType=${type ?? 'ALL'}`);
    return found.kind === 'ok' ? found.data.items : vocabulary.kind === 'ok' ? vocabulary.data.items : [];
  };
  const options = await Promise.all(library.items.map((item) => metricsFor(item.companyType)));
  const links = pagerLinks({ ...library, itemCount: library.items.length }, position, keepParams(search));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader breadcrumbs={crumbs} title="Deal criticals" description="Your firm’s red lines, written once and rated on every pact of the type as Good, Even, Bad or No evidence. Sellers never see them." />
      <OutcomeBanner outcome={outcome} messages={OUTCOMES} />
      {library.canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Write a critical</CardTitle>
            <CardDescription>In your own words, e.g. “Occupancy at or above 90% in each of the last 3 years”. Pactlab proposes the structured form; you confirm it before it can rate anything.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createStandard} className="flex flex-wrap items-end gap-2 text-sm">
              <label className="flex grow flex-col gap-1">
                <span className="text-xs text-muted-foreground">The critical, in your words</span>
                <input name="words" required minLength={3} maxLength={500} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Applies to</span>
                <select name="companyType" defaultValue="MULTIFAMILY" className={inputClass}>
                  <option value="ALL">All types</option>
                  {COMPANY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {COMPANY_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" size="sm">
                Propose the structure
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Only organization owners and admins change the library. Ask one to add or edit a critical.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The library</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border p-0 text-sm">
          {library.items.length === 0 ? <p className="px-6 py-4 text-muted-foreground">No criticals yet. Write the first above.</p> : null}
          {library.items.map((item, index) => (
            <div key={item.key} className="flex flex-col gap-2 px-6 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.words ?? item.structureText}</span>
                <Badge variant="evidence">{item.companyType ? COMPANY_TYPE_LABELS[item.companyType] : 'All types'}</Badge>
                {item.evaluates ? <Badge variant="reviewed">Confirmed · v{item.version}</Badge> : <Badge variant="draft">Not confirmed: rates nothing</Badge>}
                {item.promotedFromKey ? <Badge variant="calculation">Promoted from a pact</Badge> : null}
              </div>
              <p className="text-muted-foreground">
                {item.structureText ? (
                  <>
                    Structured form{item.structureSource === 'AI' ? ' (proposed by AI from the words)' : ''}: <strong>{item.structureText}</strong>
                  </>
                ) : (
                  'No structured form yet.'
                )}
                {item.problem ? <span className="text-amber-800"> {item.problem}</span> : null}
              </p>
              {library.canEdit && !item.evaluates ? (
                <form action={confirmStandard.bind(null, item.key, item.version)} className="flex flex-col gap-2">
                  <StructureFields metrics={options[index] ?? []} value={item.structure} />
                  <Button type="submit" size="sm" className="w-fit">
                    Confirm this structure
                  </Button>
                </form>
              ) : null}
              {library.canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <form action={reviseStandard.bind(null, item.key, item.version)} className="flex items-end gap-2">
                    <input name="words" defaultValue={item.words ?? ''} aria-label="New words" className={`${inputClass} w-80`} />
                    <Button type="submit" size="sm" variant="outline">
                      Edit (new version)
                    </Button>
                  </form>
                  <form action={retireStandard.bind(null, item.key, item.version)}>
                    <Button type="submit" size="sm" variant="ghost">
                      Retire
                    </Button>
                  </form>
                </div>
              ) : null}
            </div>
          ))}
          <Pager label="Criticals pages" links={links} base="/settings/criticals" />
        </CardContent>
      </Card>
    </div>
  );
}
