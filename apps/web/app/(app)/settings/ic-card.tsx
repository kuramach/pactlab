import type { IcSettingsView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet } from '../deals/_lib/api';
import { saveIcSettings, setIcMember } from './ic-actions';

/** Settings → Investment committee (T-118): the organization's committee list and its signing rule. */
export async function IcCard() {
  const result = await apiGet<IcSettingsView>('/v1/organization/ic');
  if (result.kind !== 'ok') return null;
  const view = result.data;
  return (
    <Card id="investment-committee">
      <CardHeader>
        <CardTitle>Investment committee</CardTitle>
        <CardDescription>
          The people who decide your deals. When a pact is submitted to the committee they join it to read the pack and decide. A deal lead can also add a committee member to a single pact.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Committee members">
          {view.members.map((member) => (
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
          ))}
        </ul>
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
