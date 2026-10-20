import { Badge } from '@pactlab/ui';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { formatMoney } from '../../metrics/_lib/format';
import type { ConfirmedValueView } from '../../valuation/_lib/view';

/**
 * Accepted cushions beside the price: what the diligence confirmed. Buyer-only
 * (IC memo, walk-away confidence); it adds nothing to the price or the bridge.
 */
export function ConfirmedValue({ dealId, ledger }: { dealId: string; ledger: ConfirmedValueView | undefined }) {
  if (!ledger || ledger.items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-teal/30 bg-teal/5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck aria-hidden className="h-4 w-4 text-teal" />
        <span className="font-bold">Value confirmed — not price paid</span>
        <Badge variant="neutral">buyer only</Badge>
      </div>
      <ul className="flex flex-col gap-1">
        {ledger.items.map((item) => (
          <li key={item.findingId} className="flex flex-wrap justify-between gap-2">
            <Link href={`/deals/${dealId}/findings/${item.findingId}`} className="text-indigo-ink hover:underline">
              {item.valueDriver}: {item.label}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">
              {item.impliedValue
                ? `${formatMoney({ amount: item.impliedValue.low, currency: item.impliedValue.currency })}–${formatMoney({ amount: item.impliedValue.high, currency: item.impliedValue.currency })}`
                : 'driver confirmed'}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {ledger.totals.length > 0
          ? `Confirmed ${ledger.totals.map((total) => `${formatMoney(total.low)}–${formatMoney(total.high)}`).join(', ')}${ledger.unquantified ? ` plus ${ledger.unquantified} unquantified` : ''}. `
          : ''}
        Clean diligence confirms the thesis; it never raises the price, and this is never shared with the seller.
      </p>
    </div>
  );
}
