import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet } from '../deals/_lib/api';
import { connectDocumentSource, disconnectDocumentSource } from './document-sources-actions';

interface DocumentConnection {
  provider: 'google-drive' | 'onedrive';
  label: string;
  available: boolean;
  connected: { accountName: string; connectedAt: string } | null;
}

const OUTCOMES: Record<string, string> = {
  'document-source-connected': 'Connected. Pacts can now add folders from it, and Pactlab keeps itself signed in.',
  'document-source-disconnected': 'Disconnected. Its folders stop reading until you connect again.',
  'document-source-cancelled': 'Sign-in cancelled; nothing changed.',
  'document-source-failed': 'The sign-in did not complete. Try again; if it keeps failing, the provider refused the request.',
  'document-source-unavailable': 'That provider is not set up on this Pactlab yet.',
};

/**
 * Settings → Document sources (T-147): the organization signs in to Google Drive or OneDrive / SharePoint
 * once, read-only, and every pact can add folders from it. Hidden where neither provider is set up here.
 */
export async function DocumentSourcesCard({ outcome }: { outcome?: string | undefined }) {
  const result = await apiGet<{ items: DocumentConnection[]; canEdit: boolean }>('/v1/organization/document-connections');
  if (result.kind !== 'ok') return null;
  const items = result.data.items.filter((item) => item.available);
  if (items.length === 0) return null;
  const { canEdit } = result.data;
  return (
    <Card id="document-sources">
      <CardHeader>
        <CardTitle>Document sources</CardTitle>
        <CardDescription>
          Sign in once and pacts can read deal folders straight from your drive. Pactlab only reads: it never writes, moves, shares or deletes anything there, and it stays
          signed in by itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {outcome && OUTCOMES[outcome] ? (
          <p role="status" className="rounded-md border border-border bg-muted px-3 py-2">
            {OUTCOMES[outcome]}
          </p>
        ) : null}
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Document sources">
          {items.map((item) => (
            <li key={item.provider} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.label}</span>
                {item.connected ? (
                  <>
                    <Badge variant="reviewed">Connected · {item.connected.accountName}</Badge>
                    <span className="text-muted-foreground">since {item.connected.connectedAt.slice(0, 10)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Not connected</span>
                )}
              </span>
              {canEdit ? (
                <form action={item.connected ? disconnectDocumentSource : connectDocumentSource}>
                  <input type="hidden" name="provider" value={item.provider} />
                  <Button type="submit" size="sm" variant={item.connected ? 'outline' : 'default'}>
                    {item.connected ? 'Disconnect' : `Connect ${item.label}`}
                  </Button>
                </form>
              ) : item.connected ? null : (
                <span className="text-muted-foreground">An organization owner or administrator connects it.</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
