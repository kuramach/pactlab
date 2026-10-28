'use client';

import { Badge } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { closeRequest } from './actions';

export interface DocumentRequestView {
  readonly id: string;
  readonly status: 'OPEN' | 'CLOSED';
  readonly note: string | null;
  readonly createdAt: string;
  readonly items: readonly { readonly id: string; readonly label: string; readonly received: boolean }[];
}

/**
 * Requests for missing inputs (T-098), seen by both sides of the pact. The
 * seller uploads here; each item ticks off once their file is filed under it.
 */
export function RequestsCard({ dealId, requests, buyer }: { dealId: string; requests: readonly DocumentRequestView[]; buyer: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const open = requests.filter((request) => request.status === 'OPEN');
  if (open.length === 0) return null;
  return (
    <section aria-labelledby="requests" className="flex flex-col gap-2 text-sm">
      <h3 id="requests" className="font-semibold">
        {buyer ? 'Requested from the seller' : 'The buyer has asked for'}
      </h3>
      {open.map((request) => {
        const received = request.items.filter((item) => item.received).length;
        return (
          <div key={request.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Sent {request.createdAt.slice(0, 10)} · {received} of {request.items.length} received
              </span>
              {buyer ? (
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    void closeRequest(dealId, request.id).then((result) => {
                      if (result.kind === 'error') setError(result.message);
                      else router.refresh();
                    })
                  }
                >
                  Close request
                </button>
              ) : null}
            </div>
            {request.note ? <p>{request.note}</p> : null}
            <ul className="flex flex-col gap-1">
              {request.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <span>{item.label}</span>
                  <Badge variant={item.received ? 'reviewed' : 'draft'}>{item.received ? 'Received' : 'Waiting'}</Badge>
                </li>
              ))}
            </ul>
            {!buyer ? <p className="text-xs text-muted-foreground">Upload the files above — one at a time, several together, or one zip. They tick off here once the buyer’s team has them filed.</p> : null}
          </div>
        );
      })}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </section>
  );
}
