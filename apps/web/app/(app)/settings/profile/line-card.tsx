import type { ContactChannelView, ContactProfileView } from '@pactlab/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import type { I18n } from '../../../../lib/i18n';
import { addLineFriend, connectLine, disconnectChannel, testChannel } from './actions';

/**
 * Your profile → LINE (T-182): the same shape as the Telegram card. Connecting is two steps, LINE Login
 * then the friend added; between them the card says so and offers the add-friend page in LINE.
 */
export function LineCard({
  t,
  channel,
  line,
}: {
  t: I18n;
  channel: ContactChannelView | undefined;
  line: ContactProfileView['line'];
}) {
  const words = t.m.settings.line;
  return (
    <Card id="line">
      <CardHeader>
        <CardTitle>{words.title}</CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {channel ? (
          <>
            <p className="text-sm">
              <span className="font-medium">{words.connected}</span> ·{' '}
              <span className="text-emerald-800">{words.verified}</span>{' '}
              <span className="text-muted-foreground">
                {t.fill(words.since, { date: t.date(channel.verifiedAt) })}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <form action={testChannel.bind(null, channel.id)}>
                <Button type="submit" size="sm" variant="outline">
                  {words.test}
                </Button>
              </form>
              <form action={disconnectChannel.bind(null, channel.id)}>
                <Button type="submit" size="sm" variant="ghost">
                  {words.disconnect}
                </Button>
              </form>
            </div>
            <p className="text-xs text-muted-foreground">{words.disconnectHint}</p>
          </>
        ) : !line ? (
          <p className="text-sm text-muted-foreground">{words.off}</p>
        ) : line.pending ? (
          <>
            <p className="text-sm">{words.pending}</p>
            <div className="flex flex-wrap gap-2">
              <form action={addLineFriend}>
                <Button type="submit" size="sm">
                  {words.addFriend}
                </Button>
              </form>
              <form action={connectLine}>
                <Button type="submit" size="sm" variant="ghost">
                  {words.startAgain}
                </Button>
              </form>
            </div>
          </>
        ) : (
          <>
            <form action={connectLine}>
              <Button type="submit" size="sm">
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
