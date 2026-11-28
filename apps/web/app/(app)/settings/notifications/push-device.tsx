'use client';

import { Button } from '@pactlab/ui';
import { useEffect, useState } from 'react';
import { subscribeThisDevice } from './alert-actions';

type State = 'checking' | 'unsupported' | 'denied' | 'ready' | 'working' | 'on' | 'failed';

export interface PushDeviceWords {
  readonly turnOn: string;
  readonly turningOn: string;
  readonly on: string;
  readonly unsupported: string;
  readonly denied: string;
  readonly failed: string;
}

/** The VAPID public key (base64url) as the bytes `applicationServerKey` takes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * "Alerts on this device" (T-146): the standard Push API with Pactlab's VAPID key. Permission is asked
 * only when the person presses the button (browsers, and iOS in particular, require a gesture). The
 * service worker (`/push-sw.js`) only shows notifications; it caches nothing.
 */
export function PushDevice({ publicKey, words }: { publicKey: string; words: PushDeviceWords }) {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    if (!supported()) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('denied');
    void navigator.serviceWorker
      .getRegistration('/push-sw.js')
      .then(async (registration) => setState((await registration?.pushManager.getSubscription()) ? 'on' : 'ready'))
      .catch(() => setState('ready'));
  }, []);

  async function turnOn() {
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setState(permission === 'denied' ? 'denied' : 'ready');
      const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = subscription.toJSON();
      const result = await subscribeThisDevice({ endpoint: json.endpoint, keys: json.keys });
      setState(result.ok ? 'on' : 'failed');
    } catch {
      setState('failed');
    }
  }

  if (state === 'checking') return null;
  if (state === 'unsupported') return <p className="text-sm text-muted-foreground">{words.unsupported}</p>;
  if (state === 'denied') return <p role="alert" className="text-sm text-red-800">{words.denied}</p>;
  if (state === 'on') return <p role="status" className="text-sm text-emerald-800">{words.on}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" size="sm" onClick={() => void turnOn()} disabled={state === 'working'}>
          {state === 'working' ? words.turningOn : words.turnOn}
        </Button>
      </div>
      {state === 'failed' ? <p role="alert" className="text-sm text-red-800">{words.failed}</p> : null}
    </div>
  );
}
