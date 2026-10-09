'use client';

import { Badge, Button, buttonVariants } from '@pactlab/ui';
import { useActionState, useState } from 'react';
import { connectGitHub, syncNow, type ConnectState } from './actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const CHECK_LABELS = {
  credentials: 'Access',
  reachability: 'Repository',
  scopes: 'Read permission',
  mappings: 'Contributor map',
} as const;
const STATUS_VARIANT = { PASS: 'calculation', FAIL: 'danger', SKIPPED: 'neutral' } as const;
const STATUS_TEXT = { PASS: 'OK', FAIL: 'Problem', SKIPPED: 'Not checked' } as const;

export function ConnectGitHubForm({ dealId, installUrl }: { dealId: string; installUrl: string | null }) {
  const [method, setMethod] = useState<'APP' | 'TOKEN'>(installUrl ? 'APP' : 'TOKEN');
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectGitHub.bind(null, dealId), { kind: 'idle' });

  if (state.kind === 'connected') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          <span className="font-medium">{state.name}</span>{' '}
          {state.validation.ok ? 'is connected.' : 'was added, but a check failed. Fix it on GitHub, then check again from Sources.'}
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          {state.validation.checks.map((check) => (
            <li key={check.name} className="flex items-start gap-3">
              <Badge variant={STATUS_VARIANT[check.status]}>{STATUS_TEXT[check.status]}</Badge>
              <span>
                <span className="font-medium">{CHECK_LABELS[check.name]}</span> — {check.detail}
              </span>
            </li>
          ))}
        </ul>
        <form action={syncNow.bind(null, dealId, state.connectionId)}>
          <Button type="submit" disabled={!state.validation.ok}>
            Sync now
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      {state.kind === 'error' ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="method" value={method} />
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">How to connect</legend>
        <label className="flex cursor-pointer flex-col gap-1 rounded-lg border border-border p-3 text-sm has-[:checked]:border-indigo-ink has-[:checked]:bg-muted">
          <span className="flex items-center gap-2 font-medium">
            <input type="radio" checked={method === 'APP'} disabled={!installUrl} onChange={() => setMethod('APP')} />
            Pactlab GitHub App
            <Badge variant="calculation">Recommended</Badge>
          </span>
          <span className="text-muted-foreground">
            The seller installs a read-only app on the repositories they choose and can revoke it any time. No tokens change hands.
          </span>
        </label>
        <label className="flex cursor-pointer flex-col gap-1 rounded-lg border border-border p-3 text-sm has-[:checked]:border-indigo-ink has-[:checked]:bg-muted">
          <span className="flex items-center gap-2 font-medium">
            <input type="radio" checked={method === 'TOKEN'} onChange={() => setMethod('TOKEN')} />
            Access token
          </span>
          <span className="text-muted-foreground">For sellers who can’t install apps: a fine-grained token with read-only access.</span>
        </label>
      </fieldset>

      {method === 'APP' && installUrl ? (
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>
            Ask the seller’s GitHub admin to{' '}
            <a href={installUrl} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              Install the Pactlab GitHub App
            </a>{' '}
            and select the repository.
          </li>
          <li>Enter the repository below and connect.</li>
        </ol>
      ) : null}
      {method === 'TOKEN' ? (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>On GitHub: Settings → Developer settings → Fine-grained tokens → Generate new token.</li>
          <li>Resource owner: the organization; Repository access: only this repository.</li>
          <li>Permissions: Contents — Read-only (Metadata is added automatically). Nothing else.</li>
        </ol>
      ) : null}

      <label className="flex flex-col gap-1 text-sm font-medium">
        Repository
        <input name="repository" placeholder="owner/name" required className={inputClass} autoComplete="off" />
      </label>
      {method === 'TOKEN' ? (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Fine-grained token
          <input name="token" type="password" required className={inputClass} autoComplete="off" spellCheck={false} />
          <span className="text-xs font-normal text-muted-foreground">
            Stored encrypted and used only to read commit history. Pactlab never shows it again.
          </span>
        </label>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect and check'}
        </Button>
      </div>
    </form>
  );
}
