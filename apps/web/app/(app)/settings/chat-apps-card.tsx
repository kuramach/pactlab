import type { ChatAppsView, ChatAppView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet } from '../deals/_lib/api';
import { installChatApp, uninstallChatApp } from './chat-apps-actions';

const OUTCOMES: Record<string, string> = {
  'chat-slack-installed': 'Pactlab is installed in your Slack workspace. Members can now connect Slack from their profile.',
  'chat-teams-installed': 'Pactlab is connected to your Microsoft Teams tenant. Members can connect Teams once the Pactlab app is deployed to them.',
  'chat-slack-uninstalled': 'Pactlab is removed from Slack. No more Slack messages will be sent.',
  'chat-teams-uninstalled': 'Pactlab is removed from Teams. No more Teams messages will be sent.',
  'chat-slack-taken': 'That Slack workspace is already connected to another Pactlab organization.',
  'chat-teams-taken': 'That Microsoft tenant is already connected to another Pactlab organization.',
  'chat-slack-cancelled': 'The Slack install was cancelled.',
  'chat-teams-cancelled': 'The Microsoft sign-in was cancelled.',
};

function Row({ name, provider, app, canEdit, help }: { name: string; provider: 'slack' | 'teams'; app: ChatAppView; canEdit: boolean; help: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <div className="flex flex-col gap-1">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">{help}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!app.available ? (
          <span className="text-muted-foreground">Not set up on this Pactlab yet.</span>
        ) : app.installed ? (
          <>
            <Badge variant="reviewed">Installed{app.installedAt ? ` · since ${app.installedAt.slice(0, 10)}` : ''}</Badge>
            {app.linkedCount !== null ? <span className="text-muted-foreground">{app.linkedCount === 1 ? '1 member connected' : `${app.linkedCount} members connected`}</span> : null}
            {canEdit ? (
              <form action={uninstallChatApp.bind(null, provider)}>
                <Button type="submit" size="sm" variant="outline">
                  Remove
                </Button>
              </form>
            ) : null}
          </>
        ) : canEdit ? (
          <form action={installChatApp.bind(null, provider)}>
            <Button type="submit" size="sm">
              {provider === 'slack' ? 'Add to Slack' : 'Connect Microsoft Teams'}
            </Button>
          </form>
        ) : (
          <span className="text-muted-foreground">Not installed. An organization owner or administrator installs it.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Settings → Connected apps → Slack / Microsoft Teams (T-181): an organization admin installs Pactlab
 * once; each member then connects from their profile. Messages are direct, from the Pactlab bot, and
 * carry no deal details. Admins see how many members are connected, never anyone's Slack or Teams id.
 */
export async function ChatAppsCard({ outcome, canEdit }: { outcome?: string | undefined; canEdit: boolean }) {
  const result = await apiGet<ChatAppsView>('/v1/organization/chat-apps');
  if (result.kind !== 'ok' || (!result.data.slack.available && !result.data.teams.available)) return null;
  const message = outcome ? OUTCOMES[outcome] : undefined;
  const failed = outcome?.startsWith('chat-') && !message;
  return (
    <Card id="chat-apps">
      <CardHeader>
        <CardTitle>Slack and Microsoft Teams</CardTitle>
        <CardDescription>Pactlab messages people directly when a pact needs them: no pact names, amounts or documents, only a link that needs sign-in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {message ? (
          <p role="status" className="text-sm text-emerald-800">
            {message}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="text-sm text-red-800">
            That did not work. Try again; if it keeps failing, check the app is set up as the runbook says.
          </p>
        ) : null}
        <div className="divide-y divide-border">
          <Row name="Slack" provider="slack" app={result.data.slack} canEdit={canEdit} help="Installs the Pactlab app in your workspace with send-only permissions." />
          <Row name="Microsoft Teams" provider="teams" app={result.data.teams} canEdit={canEdit} help="Sign in with Microsoft to link your tenant, then deploy the Pactlab app from the Teams admin centre." />
        </div>
      </CardContent>
    </Card>
  );
}
