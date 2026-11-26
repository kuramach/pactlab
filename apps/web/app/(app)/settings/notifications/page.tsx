import { DIGEST_CADENCE_LABELS, DIGEST_CADENCES, EMAIL_MODE_LABELS, EMAIL_MODES, type NotificationSettings, type PactNotificationOverride } from '@pactlab/domain';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@pactlab/ui';
import Link from 'next/link';
import { z } from 'zod';
import { keepParams, Pager, pagerLinks, readPage } from '../../../_components/pager';
import { apiGet, dealsApi } from '../../deals/_lib/api';
import { ApiState } from '../../deals/_lib/states';
import { saveNotificationSettings, savePactNotificationSettings } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const selectClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const hhmm = (value: number | null) => (value === null ? '' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`);
const ZONES: readonly string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

function ModeSelect({ name, label, value, inherit }: { name: string; label: string; value: string | null; inherit?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select name={name} defaultValue={value ?? 'INHERIT'} className={selectClass}>
        {inherit ? <option value="INHERIT">{inherit}</option> : null}
        {EMAIL_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {EMAIL_MODE_LABELS[mode]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Settings → Notifications (T-145): how you hear what changes on your pacts. Act now: a signature,
 * terms to answer, a deadline within two days, an IC decision, a question for you. For your
 * information: documents, findings, members, valuations and syncs.
 */
export default async function NotificationSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const dealParam = typeof params['deal'] === 'string' && z.uuid().safeParse(params['deal']).success ? params['deal'] : null;
  const query = typeof params['q'] === 'string' ? params['q'].trim().slice(0, 200) : '';
  const saved = params['saved'];
  const position = readPage(params);
  const [settings, pacts, chosen, override] = await Promise.all([
    apiGet<NotificationSettings>('/v1/notification-settings'),
    dealsApi.list({ ...(query ? { q: query } : {}), ...(position.cursor ? { cursor: position.cursor } : {}), limit: 20 }),
    dealParam ? dealsApi.get(dealParam) : null,
    dealParam ? apiGet<PactNotificationOverride>(`/v1/deals/${dealParam}/notification-settings`) : null,
  ]);
  if (settings.kind !== 'ok') return <ApiState result={settings} />;
  const person = settings.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        tone="navy"
        breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/settings', label: 'Settings' }, { label: 'Notifications' }]}
        title="Notifications"
        description="How you hear what changes on your pacts. Everything is always in your inbox behind the bell; these choose what is also emailed, and when."
      />
      {saved === 'yes' ? <p role="status" className="text-sm text-emerald-800">Saved.</p> : saved === 'invalid' ? <p role="alert" className="text-sm text-red-800">That could not be saved. Check the quiet hours and time zone, then try again.</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>For every pact</CardTitle>
          <CardDescription>
            Act now: a signature waiting for you, terms to answer, a deadline within two days, an investment committee decision, a question for you. For your information: new documents from the other side, findings, people joining, valuations submitted and syncs.
            Emails name the pact and what happened, and link back; never amounts, valuations or document text.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveNotificationSettings} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-3">
              <ModeSelect name="actNow" label="Act now" value={person.actNow} />
              <ModeSelect name="fyi" label="For your information" value={person.fyi} />
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Digest</span>
                <select name="digest" defaultValue={person.digest} className={selectClass}>
                  {DIGEST_CADENCES.map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {DIGEST_CADENCE_LABELS[cadence]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="grid gap-4 md:grid-cols-3">
              <legend className="mb-2 text-sm font-medium">Quiet hours (no email; leave both empty for none)</legend>
              <label className="flex flex-col gap-1 text-sm">
                <span>From</span>
                <input type="time" name="quietStart" defaultValue={hhmm(person.quietStart)} className={selectClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Until</span>
                <input type="time" name="quietEnd" defaultValue={hhmm(person.quietEnd)} className={selectClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Time zone</span>
                <select name="timeZone" defaultValue={person.timeZone} className={selectClass}>
                  {(ZONES.includes(person.timeZone) ? ZONES : [person.timeZone, ...ZONES]).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="actNowThroughQuiet" defaultChecked={person.actNowThroughQuiet} className="h-4 w-4 accent-navy" />
              Email act-now items during quiet hours too
            </label>
            <div>
              <Button type="submit" size="sm">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card id="pact">
        <CardHeader>
          <CardTitle>For one pact</CardTitle>
          <CardDescription>Override how you hear about one pact, for example every update at once on a deal in full flight. Time zone, digest and quiet hours stay yours.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {chosen?.kind === 'ok' && override?.kind === 'ok' && dealParam ? (
            <form action={savePactNotificationSettings.bind(null, dealParam)} className="flex flex-col gap-4">
              <p className="text-sm font-medium">{chosen.data.name}</p>
              <div className="grid gap-4 md:grid-cols-2">
                <ModeSelect name="actNow" label="Act now" value={override.data.actNow} inherit={`As for every pact (${EMAIL_MODE_LABELS[person.actNow]})`} />
                <ModeSelect name="fyi" label="For your information" value={override.data.fyi} inherit={`As for every pact (${EMAIL_MODE_LABELS[person.fyi]})`} />
              </div>
              <div className="flex gap-3">
                <Button type="submit" size="sm">
                  Save for this pact
                </Button>
                <Link href="/settings/notifications#pact" className="self-center text-sm text-indigo-ink hover:underline">
                  Choose another pact
                </Link>
              </div>
            </form>
          ) : (
            <>
              <form action="/settings/notifications#pact" role="search" className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="pact-search">
                  Search your pacts
                </label>
                <input id="pact-search" name="q" type="search" defaultValue={query} placeholder="Search your pacts" maxLength={200} className={`${selectClass} w-full max-w-sm`} />
                <Button type="submit" size="sm" variant="outline">
                  Search
                </Button>
              </form>
              {pacts.kind !== 'ok' ? (
                <ApiState result={pacts} />
              ) : pacts.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pacts match.</p>
              ) : (
                <>
                  <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Your pacts">
                    {pacts.data.items.map((pact) => (
                      <li key={pact.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>{pact.name}</span>
                        <Link href={`/settings/notifications?deal=${pact.id}#pact`} className="font-medium text-indigo-ink hover:underline" aria-label={`Choose notifications for ${pact.name}`}>
                          Choose
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Pager label="Pact pages" base="/settings/notifications" links={pagerLinks({ ...pacts.data, itemCount: pacts.data.items.length }, position, keepParams(params))} />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
