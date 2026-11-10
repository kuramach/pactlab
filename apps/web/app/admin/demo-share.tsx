'use client';

import { Button } from '@pactlab/ui';
import { useActionState, useState } from 'react';
import { shareDemo, type DemoShareState } from './demo-actions';

const field = 'rounded-md border border-border bg-background px-2 py-1';

function CopyLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly value={url} aria-label={label} className={`${field} w-full max-w-xl font-mono text-xs`} onFocus={(event) => event.currentTarget.select()} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/** Share a demo (T-113): who it is for and how long; the two links are shown here once. */
export function DemoShareForm() {
  const [state, action, pending] = useActionState<DemoShareState, FormData>(shareDemo, { kind: 'idle' });
  return (
    <div className="flex flex-col gap-4 text-sm">
      <form action={action} className="flex flex-wrap items-end gap-3" aria-label="Share a demo">
        <label className="flex flex-col gap-1 font-medium">
          Shared with
          <input name="sharedWith" required maxLength={200} placeholder="Jane Doe, Acme Capital" className={`${field} w-72`} />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          For
          <select name="hours" defaultValue="72" className={field}>
            <option value="24">1 day</option>
            <option value="72">3 days</option>
            <option value="168">1 week</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Sharing…' : 'Share a demo'}
        </Button>
      </form>
      {state.kind === 'error' ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'shared' ? (
        <div role="status" className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
          <p>
            Demo {state.slot} is shared with <span className="font-semibold">{state.sharedWith}</span> until {new Date(state.endsAt).toUTCString()}. Copy the links now: they are not shown
            again.
          </p>
          <CopyLink label="Buyer link" url={state.buyerUrl} />
          <CopyLink label="Seller link" url={state.sellerUrl} />
        </div>
      ) : null}
    </div>
  );
}
