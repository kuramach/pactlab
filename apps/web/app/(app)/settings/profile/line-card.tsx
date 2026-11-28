import type { ContactProfileView } from '@pactlab/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import type { I18n } from '../../../../lib/i18n';
import { connectLine, disconnectChannel, testChannel } from './actions';

/**
 * Your profile → LINE (T-182): Connect LINE signs in with LINE Login, then the person adds the Pactlab LINE
 * Official Account as a friend; the channel exists only once both are done. Words from the catalog.
 */
export function LineCard({ t, me }: { t: I18n; me: ContactProfileView }) {
  const words = t.m.settings.line;
  const line = me.channels.find((channel) => channel.kind === 'LINE');
  return (
    <Card id="line">
      <CardHeader>
        <CardTitle>{words.title}</CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {line ? (
          <>
            <p className="text-sm">
              <span className="font-medium">{words.connected}</span> · <span className="text-emerald-800">{words.verified}</span>{' '}
              <span className="text-muted-foreground">{t.fill(words.since, { date: t.date(line.verifiedAt) })}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <form action={testChannel.bind(null, line.id)}>
                <Button type="submit" size="sm" variant="outline">
                  {words.test}
                </Button>
              </form>
              <form action={disconnectChannel.bind(null, line.id)}>
                <Button type="submit" size="sm" variant="ghost">
                  {words.disconnect}
                </Button>
              </form>
            </div>
            <p className="text-xs text-muted-foreground">{words.disconnectHint}</p>
          </>
        ) : !me.available.line ? (
          <p className="text-sm text-muted-foreground">{words.off}</p>
        ) : (
          <>
            {me.linePending ? (
              <div role="status" className="flex flex-col gap-2 text-sm">
                <p className="font-medium">{words.pendingTitle}</p>
                <p className="text-muted-foreground">{words.pendingHint}</p>
                {me.linePending.addFriendUrl ? (
                  <a href={me.linePending.addFriendUrl} rel="noopener noreferrer" target="_blank" className="underline">
                    {words.addFriend}
                  </a>
                ) : null}
              </div>
            ) : null}
            <form action={connectLine}>
              <Button type="submit" size="sm" variant={me.linePending ? 'outline' : 'default'}>
                {words.connect}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">{words.connectHint}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
