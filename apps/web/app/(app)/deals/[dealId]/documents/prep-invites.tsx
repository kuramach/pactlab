'use client';

import type { PrepInviteView } from '@pactlab/contracts';
import { Badge, Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyButton } from '../../../_lib/copy-button';
import { createPrepInvite, revokePrepInvite, type PrepInviteResult } from './actions';

const STATE: Record<PrepInviteView['state'], string> = { PENDING: 'Waiting', ACCEPTED: 'Bound', EXPIRED: 'Expired', REVOKED: 'Revoked' };

/**
 * Prep invites (T-178b, ADR 0059): ask someone to prepare the documents in Pactlab Rinse. Their free
 * preparer account is bound to this pact only; it never sees the pact. Sets they finish come in here,
 * and a set bound to another pact is refused. Ending the binding refuses their sets from then on.
 */
export function PrepInvites({ dealId, invites }: { dealId: string; invites: PrepInviteView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrepInviteResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Ask the person preparing the documents to rinse them in Pactlab Rinse on their own machine. They get a free preparer account bound to this pact; it does not let them see the pact.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          void createPrepInvite(dealId, form).then((next) => {
            setResult(next);
            setBusy(false);
            if (next.kind === 'ok') router.refresh();
          });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-medium">Preparer’s email</span>
          <input type="email" name="email" required className="rounded-md border border-border px-2 py-1" />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? 'Inviting…' : 'Invite a preparer'}
        </Button>
      </form>
      {result?.kind === 'error' ? (
        <p role="alert" className="text-destructive">
          {result.message}
        </p>
      ) : null}
      {result?.kind === 'ok' ? (
        <div role="status" className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
          <span>{result.emailSent ? `Invite emailed to ${result.email}.` : `The email to ${result.email} was not sent: send them this link another way.`} The link works once, for 14 days, and is shown only now.</span>
          <span className="flex flex-wrap items-center gap-2">
            <code className="break-all text-xs">{result.link}</code>
            <CopyButton text={result.link} label="Copy link" />
          </span>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      ) : null}
      {invites.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Prep invites">
          {invites.map((invite) => {
            const bound = invite.binding && !invite.binding.revokedAt;
            return (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="font-medium">{invite.email}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={bound ? 'reviewed' : 'draft'}>{invite.binding?.revokedAt ? 'Unbound' : STATE[invite.state]}</Badge>
                  {invite.state === 'PENDING' || bound ? (
                    <Button
                      variant="link"
                      size="sm"
                      type="button"
                      onClick={() => {
                        void revokePrepInvite(dealId, invite.id).then((next) => {
                          setProblem(next.kind === 'error' ? next.message : null);
                          if (next.kind === 'ok') router.refresh();
                        });
                      }}
                    >
                      {bound ? 'End binding' : 'Revoke'}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
