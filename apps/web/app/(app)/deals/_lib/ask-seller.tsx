'use client';

import { Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { requestFromSeller } from '../[dealId]/documents/actions';

/** Ask the seller for the files a missing figure needs, inside the pact (the Documents page's requests, T-098). */
export function AskSellerButton({ dealId, items, note, label }: { dealId: string; items: readonly string[]; note: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ sent: boolean; message: string | null }>({ sent: false, message: null });
  if (state.sent) return <span className="font-medium text-emerald-800">Requested from the seller</span>;
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={pending || items.length === 0}
        onClick={() =>
          start(async () => {
            const result = await requestFromSeller(dealId, items, note);
            if (result.kind === 'ok') {
              setState({ sent: true, message: null });
              router.refresh();
            } else setState({ sent: false, message: result.message });
          })
        }
      >
        {pending ? 'Sending…' : label}
      </Button>
      {state.message ? (
        <span role="alert" className="text-red-700">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
