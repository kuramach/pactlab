import type { IcSettingsView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { keepParams, Pager, pagerLinks, readPage } from '../../_components/pager';
import { apiGet } from '../deals/_lib/api';
import { saveIcSettings, setIcMember } from './ic-actions';

/** Settings → Investment committee (T-118): the organization's committee list and its signing rule. */
export async function IcCard({ search }: { search: Record<string, string | string[] | undefined> }) {
  // The committee itself in full; the rest of the organization a page at a time, searchable (T-126).
  const position = readPage(search, 'icp');
  const q = typeof search['icq'] === 'string' ? search['icq'].trim().slice(0, 120) : '';
  const query = new URLSearchParams({ ...(q ? { q } : {}), ...(position.cursor ? { cursor: position.cursor } : {}) }).toString();
  const result = await apiGet<IcSettingsView>(`/v1/organization/ic${query ? `?${query}` : ''}`);
  if (result.kind !== 'ok') return null;
  const view = result.data;
  const row = (member: IcSettingsView['people']['items'][number]) => (
    <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <span className="flex items-center gap-2">
        {member.name}
        {member.investmentCommittee ? <Badge variant="reviewed">Committee</Badge> : null}
      </span>
      {view.canEdit ? (
        <form action={setIcMember.bind(null, member.userId, !member.investmentCommittee)}>
          <Button type="submit" size="sm" variant="ghost">
            {member.investmentCommittee ? 'Remove from committee' : 'Add to committee'}
          </Button>
        </form>
      ) : null}
    </li>
  );
  return (
    <Card id="investment-committee" section="investment-committee">
      <CardHeader>
        <CardTitle>Investment committee</CardTitle>
        <CardDescription>
          The people who decide your deals. When a pact is submitted to the committee they join it to read the pack and decide. A deal lead can also add a committee member to a single pact.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {view.committee.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Committee members">
            {view.committee.map(row)}
          </ul>
        ) : (
          <p className="text-muted-foreground">No one is on the committee yet.</p>
        )}
        {view.canEdit ? (
          <div className="flex flex-col gap-2">
            <form method="get" action="/settings#investment-committee" role="search" className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 font-medium">
                Add someone
                <input name="icq" defaultValue={q} maxLength={120} placeholder="Name or email" className="rounded-md border border-border bg-background px-3 py-1.5" />
              </label>
              <Button type="submit" size="sm" variant="outline">
                Search
              </Button>
            </form>
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label="People in your organization">
              {view.people.items.map(row)}
            </ul>
            <Pager label="People pages" base="/settings" links={pagerLinks({ ...view.people, itemCount: view.people.items.length }, position, keepParams(search), 'icp')} />
          </div>
        ) : null}
        {view.canEdit ? (
          <form action={saveIcSettings} className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="required" defaultChecked={view.required} /> Require committee approval before signing (each pact can override)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="clearsConditions" defaultChecked={view.clearsConditions} /> The committee clears its own conditions (otherwise the deal team marking them addressed is enough)
            </label>
            <div>
              <Button type="submit" size="sm" variant="outline">
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground">
            Approval before signing: {view.required ? 'required' : 'not required'} by default.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
