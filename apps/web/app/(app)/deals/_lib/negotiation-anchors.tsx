import type { AnchorsView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Glossed, IconTile } from '@pactlab/ui';
import { Anchor, ExternalLink, MessageSquareQuote, Star } from 'lucide-react';
import Link from 'next/link';
import { formatMoney } from '../../metrics/_lib/format';
import { ANCHOR_FLAG_LABELS, ORIGIN_LABELS, formatMultiple, fractionToPercentLabel } from '../../comparables/_lib/view';
import { BarChart, CHART_COLORS } from '../../_lib/charts';
import { CopyButton } from '../../_lib/copy-button';
import { addAnchor, removeAnchor } from '../[dealId]/benchmark-actions';

/** Messages for the anchor actions' outcomes. */
export const ANCHOR_OUTCOMES: Readonly<Record<string, string>> = {
  'ok-anchor': 'Anchor added. Its counter-price and talking point are below.',
  'ok-anchor-removed': 'Anchor removed.',
  'anchor-exists': 'That comparable is already an anchor.',
  'anchor-choose': 'Choose a comparable to cite.',
  'anchor-refused': 'That comparable can’t be cited — your own deals are confidential, and retired comparables are out of use.',
};

const UNAVAILABLE: Record<string, string> = {
  NO_ASK: 'Record the asking price to price this anchor.',
  NO_ARR: 'Needs the target’s ARR — run a scenario or connect billing.',
  NO_BRIDGE: 'The ask is on equity value: run a scenario with cash and debt to convert.',
  CURRENCY: 'The target’s ARR and the ask are in different currencies.',
  INVALID: 'This comparable’s figures can’t form a multiple.',
};

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Public deals the deal lead cites against the ask: the target priced at each
 * deal's multiple, the reasons a seller could dismiss it, and talking points
 * to adapt. Buyer side only; Pactlab never sends anything to the seller.
 */
export function NegotiationAnchors({ dealId, view, returnTo }: { dealId: string; view: AnchorsView; returnTo: string }) {
  const priced = view.items.flatMap((item) => (item.counter ? [{ ...item, counter: item.counter }] : []));
  const points = view.items.map((item) => item.talkingPoint).filter((text): text is string => text !== null);
  const currency = view.asking?.currency ?? 'USD';

  return (
    <Card id="negotiation-anchors">
      <CardHeader className="flex flex-row flex-wrap items-start gap-3">
        <IconTile accent="rose">
          <Anchor />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle>Negotiation anchors</CardTitle>
          <CardDescription>
            <Glossed
              text={`Public deals to cite against the ask: ${view.target.name} priced at each deal's EV ÷ ARR multiple. Pick ones the seller can check — and that they can't easily dismiss.`}
            />
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {view.items.length === 0 ? (
          <p className="text-sm text-slate-text">
            No anchors yet.{' '}
            {view.canEdit
              ? 'Add a comparable below — ideally a publicly announced acquisition with a source link.'
              : 'The deal lead chooses which public deals to cite.'}
          </p>
        ) : (
          <>
            {view.asking && priced.length > 0 ? (
              <BarChart
                label="The asking price against the counter-price at each anchor's multiple"
                categories={['Asking price', ...priced.map((item) => item.comparable.targetName)]}
                series={[
                  {
                    name: 'Price',
                    values: [view.asking.amount, ...priced.map((item) => item.counter.counterPrice.amount)],
                    colors: [CHART_COLORS.rose, ...priced.map((item) => (item.id === view.strongestId ? CHART_COLORS.teal : CHART_COLORS.indigo))],
                  },
                ]}
                currency={currency}
                height={240}
              />
            ) : null}

            <ul className="flex flex-col gap-3">
              {view.items.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 rounded-2xl border border-navy/10 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.id === view.strongestId ? <Star aria-label="Strongest clean anchor" className="h-4 w-4 fill-teal text-teal" /> : null}
                    <span className="font-bold">{item.comparable.name}</span>
                    <Badge variant={item.comparable.origin === 'SYNTHETIC' ? 'draft' : 'evidence'}>{ORIGIN_LABELS[item.comparable.origin]}</Badge>
                    {item.counter ? <span className="font-mono font-bold">{formatMultiple(item.counter.multiple)}</span> : null}
                    {item.comparable.sourceUrl ? (
                      <a href={item.comparable.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-ink hover:underline">
                        Source <ExternalLink aria-hidden className="h-3 w-3" />
                      </a>
                    ) : null}
                    {view.canEdit ? (
                      <form action={removeAnchor.bind(null, dealId, item.id, returnTo)} className="ml-auto">
                        <Button type="submit" size="sm" variant="outline">
                          Remove
                        </Button>
                      </form>
                    ) : null}
                  </div>
                  {item.counter ? (
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" data-numeric>
                      <span>
                        Counter-price <b className="font-mono">{formatMoney(item.counter.counterPrice)}</b>
                      </span>
                      <span className={item.counter.verdict === 'BELOW' ? 'font-semibold text-teal' : 'font-semibold text-rose'}>
                        {fractionToPercentLabel(item.counter.gapRatio.replace('-', ''))} {item.counter.verdict === 'BELOW' ? 'below' : item.counter.verdict === 'ABOVE' ? 'above' : 'equal to'} the ask
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Growth {fractionToPercentLabel(item.comparable.arrGrowth)} · NRR {fractionToPercentLabel(item.comparable.nrr)} · {item.comparable.announcedOn ?? 'date unknown'}
                      </span>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">{UNAVAILABLE[item.unavailable ?? 'INVALID']}</p>
                  )}
                  {item.counter && item.counter.flags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {item.counter.flags.map((flag) => (
                        <Badge key={flag} variant={flag === 'SUPPORTS_ASK' || flag === 'SYNTHETIC' ? 'danger' : 'draft'} title={ANCHOR_FLAG_LABELS[flag]?.why}>
                          {ANCHOR_FLAG_LABELS[flag]?.label ?? flag}
                        </Badge>
                      ))}
                    </div>
                  ) : item.counter ? (
                    <Badge variant="calculation" className="self-start">
                      No obvious objections
                    </Badge>
                  ) : null}
                  {item.note ? <p className="text-slate-text">“{item.note}” — {item.addedByName ?? 'deal lead'}</p> : null}
                </li>
              ))}
            </ul>

            {points.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-2xl bg-mist p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <MessageSquareQuote aria-hidden className="h-4 w-4 text-indigo-ink" />
                  <span className="font-bold">Talking points</span>
                  <span className="text-xs text-muted-foreground">For the deal lead to adapt — Pactlab never sends this.</span>
                  <span className="ml-auto">
                    <CopyButton text={points.map((point) => `• ${point}`).join('\n')} label="Copy all" />
                  </span>
                </div>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}

        {view.canEdit ? (
          view.eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other comparables to cite.{' '}
              <Link href="/comparables" className="font-semibold text-indigo-ink hover:underline">
                Add a public deal with its source
              </Link>
              .
            </p>
          ) : (
            <form action={addAnchor.bind(null, dealId, returnTo)} className="grid gap-2 sm:grid-cols-[1.2fr_1.5fr_auto]">
              <select name="comparableId" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choose a comparable to cite…
                </option>
                {view.eligible.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {formatMultiple(c.multiple)}
                    {c.origin === 'SYNTHETIC' ? ' (demo)' : ''}
                  </option>
                ))}
              </select>
              <input name="note" maxLength={500} placeholder="Why this one (optional)" className={inputClass} />
              <Button type="submit" size="sm">
                Add anchor
              </Button>
            </form>
          )
        ) : null}
        <p className="text-xs text-muted-foreground">Your firm’s own deals are confidential and can’t be cited here.</p>
      </CardContent>
    </Card>
  );
}
