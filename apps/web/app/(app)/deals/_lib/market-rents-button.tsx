'use client';

import { Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { MarketRentsOffer } from './market-rents';
import { checkMarketRents } from './market-rents-actions';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Check rents against the market (T-158): one RentCast estimate per floor plan of the rent roll. Without an
 * address on the pact or its listing, asks for it once (stored on the pact). Figures come from the calculator.
 */
export function MarketRentsButton({ dealId, offer }: { dealId: string; offer: MarketRentsOffer }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [address, setAddress] = useState('');
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  if (offer.blocked) return <span className="text-xs text-muted-foreground">{offer.blocked}</span>;
  return (
    <span className="flex max-w-sm flex-col gap-1.5 text-xs">
      {offer.needsAddress ? (
        <label className="flex flex-col gap-1 font-medium">
          Property address
          <input name="propertyAddress" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, City, State ZIP" maxLength={200} className={inputClass} />
        </label>
      ) : (
        <span className="text-muted-foreground">
          At {offer.address}
          {offer.retrievedOn ? ` · retrieved ${offer.retrievedOn}` : ''}
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={pending || (offer.needsAddress && address.trim().length < 5)}
        onClick={() =>
          start(async () => {
            const result = await checkMarketRents(dealId, offer.needsAddress ? address : null);
            setState({ ok: result.kind === 'ok', message: result.message });
            if (result.kind === 'ok') router.refresh();
          })
        }
      >
        {pending ? 'Checking…' : 'Check rents against the market'}
      </Button>
      {state ? (
        <span role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-emerald-800' : 'text-red-700'}>
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
