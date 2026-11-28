import type { ChatAppsView, ChatAppView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import type { I18n } from '../../../lib/i18n';
import { getI18n } from '../../../lib/i18n/server';
import { apiGet } from '../deals/_lib/api';
import { installChatApp, uninstallChatApp } from './chat-apps-actions';

function Row({ t, name, provider, app, canEdit, help }: { t: I18n; name: string; provider: 'slack' | 'teams'; app: ChatAppView; canEdit: boolean; help: string }) {
  const c = t.m.profile.chatApps;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <div className="flex flex-col gap-1">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">{help}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!app.available ? (
          <span className="text-muted-foreground">{c.notSetUp}</span>
        ) : app.installed ? (
          <>
            <Badge variant="reviewed">{app.installedAt ? t.fill(c.installedSince, { date: app.installedAt.slice(0, 10) }) : c.installed}</Badge>
            {app.linkedCount !== null ? <span className="text-muted-foreground">{t.plural(app.linkedCount, c.linked)}</span> : null}
            {canEdit ? (
              <form action={uninstallChatApp.bind(null, provider)}>
                <Button type="submit" size="sm" variant="outline">
                  {c.remove}
                </Button>
              </form>
            ) : null}
          </>
        ) : canEdit ? (
          <form action={installChatApp.bind(null, provider)}>
            <Button type="submit" size="sm">
              {provider === 'slack' ? c.addToSlack : c.connectTeams}
            </Button>
          </form>
        ) : (
          <span className="text-muted-foreground">{c.notInstalled}</span>
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
  const t = await getI18n();
  const c = t.m.profile.chatApps;
  const result = await apiGet<ChatAppsView>('/v1/organization/chat-apps');
  if (result.kind !== 'ok' || (!result.data.slack.available && !result.data.teams.available)) return null;
  const message = outcome ? (c.outcomes as Record<string, string>)[outcome] : undefined;
  const failed = outcome?.startsWith('chat-') && !message;
  return (
    <Card id="chat-apps">
      <CardHeader>
        <CardTitle>{c.title}</CardTitle>
        <CardDescription>{c.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {message ? (
          <p role="status" className="text-sm text-emerald-800">
            {message}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="text-sm text-red-800">
            {c.failed}
          </p>
        ) : null}
        <div className="divide-y divide-border">
          <Row t={t} name="Slack" provider="slack" app={result.data.slack} canEdit={canEdit} help={c.slackHelp} />
          <Row t={t} name="Microsoft Teams" provider="teams" app={result.data.teams} canEdit={canEdit} help={c.teamsHelp} />
        </div>
      </CardContent>
    </Card>
  );
}
