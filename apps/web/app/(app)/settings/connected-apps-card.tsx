import type { ConnectedAppView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { Plug } from 'lucide-react';
import { apiGet } from '../deals/_lib/api';
import { disconnectApp } from './connected-apps-actions';

const day = (iso: string) => iso.slice(0, 10);

/** Settings → Connected apps (T-084): AI apps such as Claude that you let read your pacts over MCP. */
export async function ConnectedAppsCard({ mcpAddress }: { mcpAddress: string }) {
  const result = await apiGet<{ apps: ConnectedAppView[] }>('/v1/me/connected-apps');
  if (result.kind !== 'ok') return null;
  const { apps } = result.data;
  return (
    <Card id="connected-apps">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" aria-hidden /> Connected apps
        </CardTitle>
        <CardDescription>
          AI apps you’ve let read your pacts, such as Claude. They see only what you can see, can’t change anything, and every request is audited. To add one, use
          this address in the app’s connector settings: <code className="font-mono text-foreground">{mcpAddress}</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No apps connected.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Your connected apps">
            {apps.map((app) => (
              <li key={app.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    {app.clientName}
                    {app.scopes.includes('mcp:confidential') ? <Badge variant="neutral">confidential</Badge> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {app.clientHost ? `${app.clientHost} · ` : ''}
                    {app.organizationName} · connected {day(app.createdAt)} · {app.lastUsedAt ? `last used ${day(app.lastUsedAt)}` : 'not used yet'}
                  </span>
                </span>
                <form action={disconnectApp.bind(null, app.id)}>
                  <Button type="submit" size="sm" variant="ghost" aria-label={`Disconnect ${app.clientName}`}>
                    Disconnect
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
