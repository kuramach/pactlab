import type { ApiAccessView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { KeyRound } from 'lucide-react';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../_components/pager';
import { apiGet } from '../deals/_lib/api';
import { revokeMemberGrant, setApiAccess } from './api-access-actions';

const day = (iso: string) => iso.slice(0, 10);

/**
 * Settings → API access (T-128), for organization owners and admins: switch the API on or off
 * for everyone, and see and remove every member's API sign-ins. Each one is a person's own grant.
 */
export async function ApiAccessCard({ search }: { search: Record<string, string | string[] | undefined> }) {
  const position = readPage(search, 'api');
  const result = await apiGet<ApiAccessView>(`/v1/organization/api-access?${pageApiQuery(position)}`);
  if (result.kind !== 'ok') return null;
  const { enabled, grants } = result.data;
  return (
    <Card id="api-access" section="api-access">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" aria-hidden /> API access
        </CardTitle>
        <CardDescription>
          Members can sign scripts and apps in to the Pactlab API as themselves: they see only what that person can see, and every change is audited under their name.
          Turning it off stops every API sign-in at once; the MCP connection for AI apps has its own switch.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={setApiAccess.bind(null, !enabled)} className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant={enabled ? 'calculation' : 'neutral'}>{enabled ? 'On' : 'Off'}</Badge>
          <Button type="submit" size="sm" variant="outline">
            {enabled ? 'Turn API access off' : 'Turn API access on'}
          </Button>
        </form>
        {grants.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has signed in a script or app yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Members’ API sign-ins">
            {grants.items.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    {grant.clientName}
                    {grant.scopes.includes('api:write') ? <Badge variant="neutral">makes changes</Badge> : <Badge variant="neutral">read only</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {grant.personName}
                    {grant.personEmail ? ` (${grant.personEmail})` : ''} · signed in {day(grant.createdAt)} · {grant.lastUsedAt ? `last used ${day(grant.lastUsedAt)}` : 'not used yet'}
                  </span>
                </span>
                <form action={revokeMemberGrant.bind(null, grant.id)}>
                  <Button type="submit" size="sm" variant="ghost" aria-label={`Remove ${grant.clientName} for ${grant.personName}`}>
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <Pager label="API sign-in pages" base="/settings" links={pagerLinks({ ...grants, itemCount: grants.items.length }, position, keepParams(search), 'api')} />
      </CardContent>
    </Card>
  );
}
