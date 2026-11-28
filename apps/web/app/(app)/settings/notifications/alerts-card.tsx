import { ALERT_CHANNELS, type AlertChannel } from '@pactlab/domain';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import type { I18n } from '../../../../lib/i18n';
import { removeDevice, saveAlertChannels, testDevice } from './alert-actions';
import { PushDevice } from './push-device';

export interface AlertsConfig {
  readonly publicKey: string | null;
  readonly available: Record<AlertChannel, boolean>;
  readonly dailyCap: number;
  readonly foldMinutes: number;
}

export interface AlertDevice {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
}

/**
 * Settings → Notifications → urgent alerts (T-146): which channels "act now" items also reach, and web
 * push on this person's devices. Channels this Pactlab does not offer are not listed; a channel not yet
 * linked says so and points to the profile, where it is connected.
 */
export function AlertsCard({ t, config, on, linked, devices, outcome }: { t: I18n; config: AlertsConfig; on: readonly AlertChannel[]; linked: ReadonlySet<AlertChannel>; devices: readonly AlertDevice[]; outcome: { alerts?: string | undefined; device?: string | undefined } }) {
  const words = t.m.settings.alerts;
  const offered = ALERT_CHANNELS.filter((channel) => config.available[channel]);
  const deviceOutcome = outcome.device === 'tested' ? words.device.tested : outcome.device === 'expired' ? words.device.expired : outcome.device === 'removed' ? words.device.removed : outcome.device === 'failed' ? words.device.failed : null;
  return (
    <Card id="alerts">
      <CardHeader>
        <CardTitle>{words.title}</CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        <p className="text-muted-foreground">{t.fill(words.limits, { cap: String(config.dailyCap), fold: String(config.foldMinutes) })}</p>
        {outcome.alerts === 'saved' ? <p role="status" className="text-emerald-800">{words.saved}</p> : outcome.alerts === 'invalid' ? <p role="alert" className="text-red-800">{words.invalid}</p> : null}
        {offered.length > 0 ? (
          <form action={saveAlertChannels} className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">{words.channelsLegend}</legend>
              {offered.map((channel) => (
                <label key={channel} className="flex items-center gap-2">
                  <input type="checkbox" name="channel" value={channel} defaultChecked={on.includes(channel)} className="h-4 w-4 accent-navy" />
                  <span>{words.channels[channel]}</span>
                  {linked.has(channel) ? null : <span className="text-muted-foreground">({words.notLinked})</span>}
                </label>
              ))}
            </fieldset>
            <p className="text-muted-foreground">
              {words.linkOnProfile}{' '}
              <Link href="/settings/profile" className="text-indigo-ink hover:underline">
                {words.profileLink}
              </Link>
            </p>
            <div>
              <Button type="submit" size="sm" variant="outline">
                {words.save}
              </Button>
            </div>
          </form>
        ) : null}
        <section aria-labelledby="this-device" className="flex flex-col gap-3">
          <h3 id="this-device" className="font-medium">
            {words.device.title}
          </h3>
          <p className="text-muted-foreground">{words.device.description}</p>
          <p className="text-muted-foreground">{words.device.iphone}</p>
          {config.publicKey ? <PushDevice publicKey={config.publicKey} words={words.device} /> : <p className="text-muted-foreground">{words.device.off}</p>}
          {deviceOutcome ? <p role="status">{deviceOutcome}</p> : null}
          <h4 className="font-medium">{words.device.list}</h4>
          {devices.length === 0 ? (
            <p className="text-muted-foreground">{words.device.none}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label={words.device.list}>
              {devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {device.label} · <span className="text-muted-foreground">{t.fill(words.device.added, { date: t.date(device.createdAt) })}</span>
                  </span>
                  <span className="flex gap-2">
                    <form action={testDevice.bind(null, device.id)}>
                      <Button type="submit" size="sm" variant="outline">
                        {words.device.test}
                      </Button>
                    </form>
                    <form action={removeDevice.bind(null, device.id)}>
                      <Button type="submit" size="sm" variant="ghost">
                        {words.device.remove}
                      </Button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
