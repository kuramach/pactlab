import type { ContactProfileView, MaskedMemberContactView, Page } from '@pactlab/contracts';
import { PHONE_COUNTRIES } from '@pactlab/domain';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@pactlab/ui';
import { getI18n } from '../../../../lib/i18n/server';
import { getSessionContext } from '../../../../lib/session';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../_components/pager';
import { apiGet } from '../../deals/_lib/api';
import { ApiState } from '../../deals/_lib/states';
import { LineCard } from './line-card';
import { confirmEmail, confirmWhatsApp, connectChat, connectTelegram, disconnectChannel, startEmail, startWhatsApp, testChannel } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const fieldClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const DONE: Record<string, string> = {
  'email-sent': 'We sent a code to that address. Enter it below to confirm it.',
  'email-confirmed': 'Your email is confirmed. Pactlab will notify you there.',
  'whatsapp-sent': 'We sent a code to that number on WhatsApp. Enter it below.',
  'whatsapp-connected': 'WhatsApp is connected.',
  'test-sent': 'Test message sent. Check your phone.',
  disconnected: 'Disconnected. Pactlab will not message you there again.',
  'slack-sent': 'Pactlab sent you a direct message in Slack. Open it and choose "Yes, connect me". It expires in 10 minutes.',
  'teams-sent': 'Pactlab sent you a message in Microsoft Teams. Open it and choose "Yes, connect me". It expires in 10 minutes.',
  'line-connected': 'LINE is connected.',
  'line-add-friend': 'Signed in with LINE. Add Pactlab as a friend on LINE to finish connecting.',
};

const ERRORS: Record<string, string> = {
  INVALID_EMAIL: 'That does not look like an email address.',
  INVALID_CODE: 'That code is not right, or it has expired. Check it, or ask for a new one.',
  INVALID_NUMBER: 'That number could not be read. Choose the country and enter the number as you would dial it.',
  CONSENT_REQUIRED: 'Tick the box to agree to WhatsApp messages first.',
  TELEGRAM_OFF: 'Telegram is not set up on this Pactlab yet.',
  WHATSAPP_OFF: 'WhatsApp is not switched on for this Pactlab.',
  EMAIL_NOT_SENT: 'The code email could not be sent just now. Try again in a minute.',
  WHATSAPP_NOT_SENT: 'The WhatsApp code could not be sent just now. Try again in a minute.',
  MESSAGE_NOT_SENT: 'The test message could not be sent. Try again, or disconnect and connect again.',
  EMAIL_REQUIRED: 'Add and confirm your email first: Pactlab finds you in Slack or Teams by it.',
  NOT_INSTALLED: 'Your organization has not connected this app yet. Ask your admin.',
  NOT_FOUND_IN_WORKSPACE: 'No one with your email was found there. In Teams, open the Pactlab app first; in Slack, check your workspace uses the same email.',
  SLACK_OFF: 'Slack is not set up on this Pactlab yet.',
  TEAMS_OFF: 'Microsoft Teams is not set up on this Pactlab yet.',
  LINE_OFF: 'LINE is not set up on this Pactlab yet.',
  LINE_CANCELLED: 'LINE Login was cancelled. Nothing was connected.',
  LINE_STATE_INVALID: 'That LINE sign-in has expired or was not started here. Choose Connect LINE again.',
  LINE_LOGIN_FAILED: 'LINE Login did not finish. Try Connect LINE again.',
  LINE_ALLOWANCE_REACHED: 'Pactlab has used this month’s LINE messages. Alerts reach you by email until next month.',
  ERROR: 'That did not work. If you tried several times, wait 15 minutes and try again.',
};

const when = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Settings → Your profile (T-180): your name, the email Pactlab writes to, and Telegram and WhatsApp
 * as message channels, each with whether it is verified. Messages never carry deal details, only a link.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const step = typeof params['step'] === 'string' ? params['step'] : null;
  const done = typeof params['done'] === 'string' ? DONE[params['done']] : undefined;
  const error = typeof params['error'] === 'string' ? (ERRORS[params['error']] ?? ERRORS['ERROR']) : undefined;
  const [session, t] = await Promise.all([getSessionContext(), getI18n()]);
  const admin = session.kind === 'signed-in' && (session.organization?.role === 'ORG_OWNER' || session.organization?.role === 'ORG_ADMIN');
  const position = readPage(params, 'members');
  const [profile, members] = await Promise.all([
    apiGet<ContactProfileView>('/v1/me/contact'),
    admin ? apiGet<Page<MaskedMemberContactView>>(`/v1/organization/contacts?${pageApiQuery(position, 25)}`) : null,
  ]);
  if (profile.kind !== 'ok') return <ApiState result={profile} />;
  const me = profile.data;
  const telegram = me.channels.find((channel) => channel.kind === 'TELEGRAM');
  const whatsapp = me.channels.find((channel) => channel.kind === 'WHATSAPP');
  const chats = [
    { provider: 'slack' as const, name: 'Slack', link: me.channels.find((channel) => channel.kind === 'SLACK'), available: me.available.slack, installed: me.chatInstalled.slack },
    { provider: 'teams' as const, name: 'Microsoft Teams', link: me.channels.find((channel) => channel.kind === 'TEAMS'), available: me.available.teams, installed: me.chatInstalled.teams },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        tone="navy"
        breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/settings', label: 'Settings' }, { label: 'Your profile' }]}
        title="Your profile"
        description="How Pactlab reaches you when a pact needs you. Only you see these details; your organization's admins see them masked."
      />
      {done ? (
        <p role="status" className="text-sm text-emerald-800">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Name</CardTitle>
          <CardDescription>How you appear on reviews, approvals and the audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{me.displayName}</p>
        </CardContent>
      </Card>

      <Card id="email">
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>Where Pactlab emails you when a pact needs you. A new address is confirmed with a code sent to it, and your current address is told.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {me.email ? (
            <p className="text-sm">
              <span className="font-medium">{me.email.address}</span> · <span className="text-emerald-800">Verified</span>
              {me.email.source === 'AUTH0_CLAIM' ? <span className="text-muted-foreground"> (from your company sign-in)</span> : me.email.source === 'SIGN_IN' ? <span className="text-muted-foreground"> (your sign-in address)</span> : null}
            </p>
          ) : (
            <p className="text-sm">No email on file yet. Add one so Pactlab can tell you when a pact needs you.</p>
          )}
          {step === 'email-code' ? (
            <form action={confirmEmail} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Code from the email</span>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${fieldClass} w-32`} />
              </label>
              <Button type="submit" size="sm">
                Confirm
              </Button>
            </form>
          ) : (
            <form action={startEmail} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{me.email ? 'Change to' : 'Your email'}</span>
                <input name="email" type="email" autoComplete="email" maxLength={254} required className={`${fieldClass} w-72`} />
              </label>
              <Button type="submit" size="sm" variant={me.email ? 'outline' : 'default'}>
                Send a code
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card id="telegram">
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>Free. Pactlab messages you in Telegram when a pact needs you, with no deal details, only a link. No phone number is needed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {telegram ? (
            <>
              <p className="text-sm">
                <span className="font-medium">Connected</span> · <span className="text-emerald-800">Verified</span> <span className="text-muted-foreground">since {when(telegram.verifiedAt)}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <form action={testChannel.bind(null, telegram.id)}>
                  <Button type="submit" size="sm" variant="outline">
                    Send a test message
                  </Button>
                </form>
                <form action={disconnectChannel.bind(null, telegram.id)}>
                  <Button type="submit" size="sm" variant="ghost">
                    Disconnect Telegram
                  </Button>
                </form>
              </div>
              <p className="text-xs text-muted-foreground">You can also disconnect from Telegram: send /stop to the bot, or block it.</p>
            </>
          ) : me.available.telegram ? (
            <>
              <form action={connectTelegram}>
                <Button type="submit" size="sm">
                  Connect Telegram
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">Opens Telegram. Tap Start in the chat with the Pactlab bot. The link works once, for 10 minutes.</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Telegram is not set up on this Pactlab yet.</p>
          )}
        </CardContent>
      </Card>

      <Card id="whatsapp">
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
          <CardDescription>Optional. Pactlab messages you on WhatsApp when a pact needs you, with no deal details, only a link. Reply STOP at any time to end them.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {whatsapp ? (
            <>
              <p className="text-sm">
                <span className="font-medium">{whatsapp.label}</span> · <span className="text-emerald-800">Verified</span>
                {whatsapp.consentedAt ? <span className="text-muted-foreground"> · agreed {when(whatsapp.consentedAt)}</span> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <form action={testChannel.bind(null, whatsapp.id)}>
                  <Button type="submit" size="sm" variant="outline">
                    Send a test message
                  </Button>
                </form>
                <form action={disconnectChannel.bind(null, whatsapp.id)}>
                  <Button type="submit" size="sm" variant="ghost">
                    Disconnect WhatsApp
                  </Button>
                </form>
              </div>
            </>
          ) : !me.available.whatsapp ? (
            <p className="text-sm text-muted-foreground">WhatsApp is not switched on for this Pactlab.</p>
          ) : step === 'whatsapp-code' ? (
            <form action={confirmWhatsApp} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Code from WhatsApp</span>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${fieldClass} w-32`} />
              </label>
              <Button type="submit" size="sm">
                Confirm
              </Button>
            </form>
          ) : (
            <form action={startWhatsApp} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Country</span>
                  <select name="dial" defaultValue="" className={fieldClass}>
                    <option value="">Number starts with +</option>
                    {PHONE_COUNTRIES.map((country) => (
                      <option key={country.iso} value={country.dial}>
                        {country.name} (+{country.dial})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">WhatsApp number</span>
                  <input name="number" type="tel" autoComplete="tel" maxLength={32} required className={`${fieldClass} w-56`} />
                </label>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-navy" />
                <span>{me.whatsappConsentText}</span>
              </label>
              <div>
                <Button type="submit" size="sm">
                  Send a code on WhatsApp
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <LineCard t={t} me={me} />

      {chats.map((chat) => (
        <Card key={chat.provider} id={chat.provider}>
          <CardHeader>
            <CardTitle>{chat.name}</CardTitle>
            <CardDescription>A direct message from the Pactlab bot when a pact needs you, with no deal details, only a link that needs sign-in. Never posted in a channel.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {chat.link ? (
              <>
                <p className="text-sm">
                  <span className="font-medium">Connected</span> · <span className="text-emerald-800">Verified</span> <span className="text-muted-foreground">since {when(chat.link.verifiedAt)}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <form action={testChannel.bind(null, chat.link.id)}>
                    <Button type="submit" size="sm" variant="outline">
                      Send a test message
                    </Button>
                  </form>
                  <form action={disconnectChannel.bind(null, chat.link.id)}>
                    <Button type="submit" size="sm" variant="ghost">
                      Disconnect {chat.name}
                    </Button>
                  </form>
                </div>
                <p className="text-xs text-muted-foreground">{chat.provider === 'slack' ? 'You can also disconnect from the Pactlab app’s Home tab in Slack.' : 'You can also disconnect by sending “stop” to the Pactlab app in Teams.'}</p>
              </>
            ) : !chat.available ? (
              <p className="text-sm text-muted-foreground">{chat.name} is not set up on this Pactlab yet.</p>
            ) : !chat.installed ? (
              <p className="text-sm text-muted-foreground">Ask your admin to connect {chat.name} for your organization.</p>
            ) : (
              <>
                <form action={connectChat.bind(null, chat.provider)}>
                  <Button type="submit" size="sm">
                    Connect {chat.provider === 'slack' ? 'Slack' : 'Teams'}
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground">Pactlab finds you by your confirmed email and sends one message asking “Is this you?”. You are connected only once you confirm there.</p>
              </>
            )}
          </CardContent>
        </Card>
      ))}

      {members ? (
        <Card id="members">
          <CardHeader>
            <CardTitle>Your organization&apos;s members</CardTitle>
            <CardDescription>Masked contact details, so you can see who can be reached. Each time this list is shown, it is recorded in the audit log.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {members.kind !== 'ok' ? (
              <ApiState result={members} />
            ) : (
              <>
                <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Members' contact details">
                  {members.data.items.map((row) => (
                    <li key={row.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="font-medium">{row.displayName}</span>
                      <span className="text-muted-foreground">
                        {[row.email ?? 'No email', row.telegram ? 'Telegram' : null, row.whatsapp, row.line].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
                <Pager label="Member pages" base="/settings/profile" links={pagerLinks({ ...members.data, itemCount: members.data.items.length }, position, keepParams(params), 'members')} />
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
