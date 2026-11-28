import type { ContactProfileView, MaskedMemberContactView, Page } from '@pactlab/contracts';
import { PHONE_COUNTRIES } from '@pactlab/domain';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@pactlab/ui';
import { getI18n } from '../../../../lib/i18n/server';
import { getSessionContext } from '../../../../lib/session';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../_components/pager';
import { apiGet } from '../../deals/_lib/api';
import { ApiState } from '../../deals/_lib/states';
import { confirmEmail, confirmWhatsApp, connectChat, connectTelegram, disconnectChannel, startEmail, startWhatsApp, testChannel } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const fieldClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const when = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Settings → Your profile (T-180): your name, the email Pactlab writes to, and Telegram and WhatsApp
 * as message channels, each with whether it is verified. Messages never carry deal details, only a link.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const t = await getI18n();
  const p = t.m.profile;
  const step = typeof params['step'] === 'string' ? params['step'] : null;
  const done = typeof params['done'] === 'string' ? (p.done as Record<string, string>)[params['done']] : undefined;
  const error = typeof params['error'] === 'string' ? ((p.errors as Record<string, string>)[params['error']] ?? p.errors.ERROR) : undefined;
  const session = await getSessionContext();
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
    { provider: 'slack' as const, name: 'Slack', short: 'Slack', link: me.channels.find((channel) => channel.kind === 'SLACK'), available: me.available.slack, installed: me.chatInstalled.slack },
    { provider: 'teams' as const, name: 'Microsoft Teams', short: 'Teams', link: me.channels.find((channel) => channel.kind === 'TEAMS'), available: me.available.teams, installed: me.chatInstalled.teams },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        tone="navy"
        breadcrumbs={[{ href: '/', label: p.breadcrumbs.home }, { href: '/settings', label: p.breadcrumbs.settings }, { label: p.title }]}
        title={p.title}
        description={p.description}
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
          <CardTitle>{p.name.title}</CardTitle>
          <CardDescription>{p.name.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{me.displayName}</p>
        </CardContent>
      </Card>

      <Card id="email">
        <CardHeader>
          <CardTitle>{p.email.title}</CardTitle>
          <CardDescription>{p.email.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {me.email ? (
            <p className="text-sm">
              <span className="font-medium">{me.email.address}</span> · <span className="text-emerald-800">{p.shared.verified}</span>
              {me.email.source === 'AUTH0_CLAIM' ? <span className="text-muted-foreground">{p.email.fromCompanySignIn}</span> : me.email.source === 'SIGN_IN' ? <span className="text-muted-foreground">{p.email.fromSignIn}</span> : null}
            </p>
          ) : (
            <p className="text-sm">{p.email.none}</p>
          )}
          {step === 'email-code' ? (
            <form action={confirmEmail} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{p.email.code}</span>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${fieldClass} w-32`} />
              </label>
              <Button type="submit" size="sm">
                {p.email.confirm}
              </Button>
            </form>
          ) : (
            <form action={startEmail} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{me.email ? p.email.changeTo : p.email.yourEmail}</span>
                <input name="email" type="email" autoComplete="email" maxLength={254} required className={`${fieldClass} w-72`} />
              </label>
              <Button type="submit" size="sm" variant={me.email ? 'outline' : 'default'}>
                {p.email.sendCode}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card id="telegram">
        <CardHeader>
          <CardTitle>{t.m.settings.alerts.channels.TELEGRAM}</CardTitle>
          <CardDescription>{p.telegram.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {telegram ? (
            <>
              <p className="text-sm">
                <span className="font-medium">{p.shared.connected}</span> · <span className="text-emerald-800">{p.shared.verified}</span> <span className="text-muted-foreground">{t.fill(p.shared.since, { date: when(telegram.verifiedAt) })}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <form action={testChannel.bind(null, telegram.id)}>
                  <Button type="submit" size="sm" variant="outline">
                    {p.shared.sendTest}
                  </Button>
                </form>
                <form action={disconnectChannel.bind(null, telegram.id)}>
                  <Button type="submit" size="sm" variant="ghost">
                    {p.telegram.disconnect}
                  </Button>
                </form>
              </div>
              <p className="text-xs text-muted-foreground">{p.telegram.alsoDisconnect}</p>
            </>
          ) : me.available.telegram ? (
            <>
              <form action={connectTelegram}>
                <Button type="submit" size="sm">
                  {p.telegram.connect}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">{p.telegram.connectHelp}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{p.telegram.off}</p>
          )}
        </CardContent>
      </Card>

      <Card id="whatsapp">
        <CardHeader>
          <CardTitle>{t.m.settings.alerts.channels.WHATSAPP}</CardTitle>
          <CardDescription>{p.whatsapp.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {whatsapp ? (
            <>
              <p className="text-sm">
                <span className="font-medium">{whatsapp.label}</span> · <span className="text-emerald-800">{p.shared.verified}</span>
                {whatsapp.consentedAt ? <span className="text-muted-foreground"> · {t.fill(p.whatsapp.agreed, { date: when(whatsapp.consentedAt) })}</span> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <form action={testChannel.bind(null, whatsapp.id)}>
                  <Button type="submit" size="sm" variant="outline">
                    {p.shared.sendTest}
                  </Button>
                </form>
                <form action={disconnectChannel.bind(null, whatsapp.id)}>
                  <Button type="submit" size="sm" variant="ghost">
                    {p.whatsapp.disconnect}
                  </Button>
                </form>
              </div>
            </>
          ) : !me.available.whatsapp ? (
            <p className="text-sm text-muted-foreground">{p.whatsapp.off}</p>
          ) : step === 'whatsapp-code' ? (
            <form action={confirmWhatsApp} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{p.whatsapp.code}</span>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${fieldClass} w-32`} />
              </label>
              <Button type="submit" size="sm">
                {p.email.confirm}
              </Button>
            </form>
          ) : (
            <form action={startWhatsApp} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{p.whatsapp.country}</span>
                  <select name="dial" defaultValue="" className={fieldClass}>
                    <option value="">{p.whatsapp.numberStartsWith}</option>
                    {PHONE_COUNTRIES.map((country) => (
                      <option key={country.iso} value={country.dial}>
                        {country.name} (+{country.dial})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{p.whatsapp.number}</span>
                  <input name="number" type="tel" autoComplete="tel" maxLength={32} required className={`${fieldClass} w-56`} />
                </label>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-navy" />
                <span>{me.whatsappConsentText}</span>
              </label>
              <div>
                <Button type="submit" size="sm">
                  {p.whatsapp.sendCode}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {chats.map((chat) => (
        <Card key={chat.provider} id={chat.provider}>
          <CardHeader>
            <CardTitle>{chat.name}</CardTitle>
            <CardDescription>{p.chat.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {chat.link ? (
              <>
                <p className="text-sm">
                  <span className="font-medium">{p.shared.connected}</span> · <span className="text-emerald-800">{p.shared.verified}</span> <span className="text-muted-foreground">{t.fill(p.shared.since, { date: when(chat.link.verifiedAt) })}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <form action={testChannel.bind(null, chat.link.id)}>
                    <Button type="submit" size="sm" variant="outline">
                      {p.shared.sendTest}
                    </Button>
                  </form>
                  <form action={disconnectChannel.bind(null, chat.link.id)}>
                    <Button type="submit" size="sm" variant="ghost">
                      {t.fill(p.chat.disconnect, { name: chat.name })}
                    </Button>
                  </form>
                </div>
                <p className="text-xs text-muted-foreground">{chat.provider === 'slack' ? p.chat.alsoDisconnectSlack : p.chat.alsoDisconnectTeams}</p>
              </>
            ) : !chat.available ? (
              <p className="text-sm text-muted-foreground">{t.fill(p.chat.off, { name: chat.name })}</p>
            ) : !chat.installed ? (
              <p className="text-sm text-muted-foreground">{t.fill(p.chat.askAdmin, { name: chat.name })}</p>
            ) : (
              <>
                <form action={connectChat.bind(null, chat.provider)}>
                  <Button type="submit" size="sm">
                    {t.fill(p.chat.connect, { name: chat.short })}
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground">{p.chat.connectHelp}</p>
              </>
            )}
          </CardContent>
        </Card>
      ))}

      {members ? (
        <Card id="members">
          <CardHeader>
            <CardTitle>{p.members.title}</CardTitle>
            <CardDescription>{p.members.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {members.kind !== 'ok' ? (
              <ApiState result={members} />
            ) : (
              <>
                <ul className="divide-y divide-border rounded-lg border border-border" aria-label={p.members.listLabel}>
                  {members.data.items.map((row) => (
                    <li key={row.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="font-medium">{row.displayName}</span>
                      <span className="text-muted-foreground">
                        {[row.email ?? p.members.noEmail, row.telegram ? 'Telegram' : null, row.whatsapp].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
                <Pager label={p.members.pagerLabel} base="/settings/profile" links={pagerLinks({ ...members.data, itemCount: members.data.items.length }, position, keepParams(params), 'members')} />
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
