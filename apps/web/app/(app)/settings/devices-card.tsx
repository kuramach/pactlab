import type { SessionPolicyView, SignedInDevicesView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { MonitorSmartphone } from 'lucide-react';
import { apiGet } from '../deals/_lib/api';
import { setSessionPolicy, signOutDevice, signOutOtherDevices } from './devices-actions';

const POLICY_LABELS: Record<SessionPolicyView['maxTrustedHours'], string> = {
  0: 'Off: every sign-in lasts 8 hours',
  24: 'Up to 1 day',
  168: 'Up to 1 week',
  720: 'Up to 30 days',
};
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
const selectClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Settings → Signed-in devices (T-112): where you are signed in, which devices you trusted
 * for a longer sign-in, and for admins the organization's limit on that.
 */
export async function DevicesCard() {
  const [devices, policy] = await Promise.all([apiGet<SignedInDevicesView>('/v1/me/sessions'), apiGet<SessionPolicyView>('/v1/organization/session-policy')]);
  if (devices.kind !== 'ok') return null;
  const others = devices.data.devices.filter((device) => !device.current).length;
  return (
    <Card id="devices">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4" aria-hidden /> Signed-in devices
        </CardTitle>
        <CardDescription>
          Where you are signed in. A trusted device stays signed in for the length you chose when signing in, and signs out after 24 hours without use. Sensitive actions,
          such as inviting people or billing, still ask you to sign in again after 8 hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Signed-in devices">
          {devices.data.devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="flex flex-col">
                <span className="flex items-center gap-2 font-medium">
                  {device.deviceLabel ?? 'A browser'}
                  {device.current ? <Badge variant="calculation">This device</Badge> : null}
                  {device.trusted ? <Badge variant="reviewed">Trusted</Badge> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  Signed in {when(device.signedInAt)} · last active {when(device.lastSeenAt)} · until {when(device.expiresAt)}
                </span>
              </span>
              <form action={signOutDevice.bind(null, device.id, device.current)}>
                <Button type="submit" size="sm" variant="ghost" aria-label={`End session on ${device.deviceLabel ?? 'a browser'}${device.current ? ' (this device)' : ''}`}>
                  End session
                </Button>
              </form>
            </li>
          ))}
        </ul>
        {others > 0 ? (
          <form action={signOutOtherDevices}>
            <Button type="submit" variant="outline">
              End all other sessions
            </Button>
          </form>
        ) : null}
        {policy.kind === 'ok' && policy.data.canEdit ? (
          <form action={setSessionPolicy} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Longest trusted sign-in for your organization
              <select name="maxTrustedHours" defaultValue={String(policy.data.maxTrustedHours)} className={selectClass}>
                {(Object.keys(POLICY_LABELS) as unknown as SessionPolicyView['maxTrustedHours'][]).map((hours) => (
                  <option key={hours} value={hours}>
                    {POLICY_LABELS[hours]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">
              Save limit
            </Button>
          </form>
        ) : policy.kind === 'ok' ? (
          <p className="text-sm text-muted-foreground">Your organization allows trusted sign-ins {POLICY_LABELS[policy.data.maxTrustedHours].toLowerCase()}.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
