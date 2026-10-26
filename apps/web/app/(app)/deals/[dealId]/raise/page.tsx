import type { OfferView, VentureSettingsView } from '@pactlab/contracts';
import { COUNTERPARTY_LABELS, COUNTERPARTY_TYPES, OFFER_STATUSES, ROUND_LABELS, ROUND_TYPES } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '../../_lib/api';
import { isUuidParam } from '../../_lib/filters';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addOffer, saveRound, setOfferStatus } from './actions';

export const dynamic = 'force-dynamic';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const OUTCOMES: Record<string, string> = {
  'ok-round': 'Round saved.',
  'ok-offer': 'Offer recorded.',
  'ok-offer-status': 'Offer updated.',
  'invalid-targetPreMoney': 'Enter your ask as an amount, e.g. 10,000,000.',
  'invalid-raiseAmount': 'Enter the amount you are raising, e.g. 2,000,000.',
  'invalid-poolTargetPct': 'Enter the pool target as a percent below 100, e.g. 10.',
  'invalid-offer-investorName': 'Name the investing firm or fund.',
  'invalid-offer-preMoney': 'Enter the offer’s pre-money as an amount.',
  conflict: 'Someone else changed this in the meantime — reload and try again.',
  forbidden: 'Your role cannot change the raise.',
};

interface Scenario {
  pricePerShare: string;
  postMoney: string;
  poolIncrease: string;
  newInvestorShares: string;
  founders: { before: string; after: string };
  poolShuffle: { statement: string };
  conversions: { securityId: string; basis: string; shares: string; mfnFrom: string | null }[];
  notes: string[];
}
interface Compared {
  currency: string | null;
  offers: { offer: OfferView; scenario: Scenario | null; missing: string[]; terms: { liquidationPreference: string; standardPreference: boolean; board: string | null; proRata: string | null; mfn: string | null } }[];
  note: string;
}
interface Readiness {
  counterparty: string;
  items: { id: string; label: string; why: string; present: boolean; evidence: string | null }[];
  present: number;
  total: number;
  complete: boolean;
}

const BASIS = { CAP: 'at its cap', DISCOUNT: 'at its discount', ROUND_PRICE: 'at the round price' } as const;
const STATUS_LABELS: Record<string, string> = { PROSPECT: 'Prospect', TERM_SHEET: 'Term sheet', DECLINED: 'Declined', SIGNED: 'Signed' };
const pct = (fraction: string | null) => (fraction === null ? '' : String(Number(fraction) * 100).replace(/\.0+$/, ''));

function Field({ label, name, defaultValue, hint, type = 'text' }: { label: string; name: string; defaultValue?: string | number | null; hint?: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input name={name} type={type} defaultValue={defaultValue ?? ''} className={inputClass} autoComplete="off" />
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/**
 * Venture Raise (T-083), founder-side: the round you are raising, every
 * investor's offer side by side through the round model, what each kind of
 * investor will ask for, and the investor view you can share.
 */
export default async function RaisePage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const query = await searchParams;
  const outcome = typeof query['outcome'] === 'string' ? query['outcome'] : undefined;
  const counterparty = typeof query['counterparty'] === 'string' && (COUNTERPARTY_TYPES as readonly string[]).includes(query['counterparty']) ? query['counterparty'] : null;
  const settings = await apiGet<{ settings: VentureSettingsView | null; canEdit: boolean }>(`/v1/deals/${dealId}/venture/settings`);
  if (settings.kind !== 'ok') return <ApiState result={settings} />;
  const [offers, compared, readiness] = await Promise.all([
    apiGet<{ items: OfferView[]; canEdit: boolean }>(`/v1/deals/${dealId}/venture/offers`),
    apiGet<Compared>(`/v1/deals/${dealId}/venture/offers/compare`),
    apiGet<Readiness>(`/v1/deals/${dealId}/venture/readiness${counterparty ? `?counterparty=${counterparty}` : ''}`),
  ]);
  const round = settings.data.settings;
  const canEdit = settings.data.canEdit;
  const currency = round?.currency ?? 'USD';

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Raise</h2>
        <p className="text-sm text-muted-foreground">
          Your round, every investor&apos;s offer through the same model, and what each kind of investor will ask for. Findings and weaknesses stay here — only the{' '}
          <strong>investor view</strong> is meant to be shared.
        </p>
      </div>
      <OutcomeBanner outcome={outcome} messages={OUTCOMES} />

      <Card>
        <CardHeader>
          <CardTitle>The round</CardTitle>
          <CardDescription>Your ask and the money you are raising. The pool target is the unallocated option pool after the round, as a percent.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveRound.bind(null, dealId)} className="grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="expectedVersion" value={round?.version ?? ''} />
            <label className="flex flex-col gap-1 text-sm font-medium">
              Round
              <select name="roundType" defaultValue={round?.roundType ?? 'SEED_PRICED'} className={inputClass}>
                {ROUND_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ROUND_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Currency" name="currency" defaultValue={currency} hint="ISO code, e.g. USD." />
            <Field label="Your ask (pre-money)" name="targetPreMoney" defaultValue={round?.targetPreMoney} />
            <Field label="Raising" name="raiseAmount" defaultValue={round?.raiseAmount} />
            <Field label="Pool target after the round (%)" name="poolTargetPct" defaultValue={round ? pct(round.poolTargetPct) : '10'} />
            <div className="flex items-end">
              <Button type="submit" disabled={!canEdit}>
                Save round
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Offers side by side</CardTitle>
          <CardDescription>{compared.kind === 'ok' ? compared.data.note : 'Each offer through the round model.'}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {compared.kind !== 'ok' ? (
            <ApiState result={compared} />
          ) : compared.data.offers.length === 0 ? (
            <p className="text-muted-foreground">No offers yet. Record each investor&apos;s bid below to compare them.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Investor</th>
                    <th className="py-2 pr-3 font-medium">Pre-money · amount</th>
                    <th className="py-2 pr-3 font-medium">Price per share</th>
                    <th className="py-2 pr-3 font-medium">Founders after</th>
                    <th className="py-2 font-medium">What the terms do</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border align-top">
                  {compared.data.offers.map(({ offer, scenario, missing, terms }) => (
                    <tr key={offer.id}>
                      <td className="py-2 pr-3">
                        <span className="font-medium">{offer.investorName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {COUNTERPARTY_LABELS[offer.counterpartyType]} · {STATUS_LABELS[offer.status]}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {offer.preMoney ?? '—'} · {offer.amount ?? '—'} {compared.data.currency ?? ''}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{scenario?.pricePerShare ?? '—'}</td>
                      <td className="py-2 pr-3">
                        {scenario ? (
                          <>
                            <b>{scenario.founders.after}%</b>
                            <span className="block text-xs text-muted-foreground">from {scenario.founders.before}%</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Needs {missing.join(' and ')}</span>
                        )}
                      </td>
                      <td className="py-2 text-xs">
                        {scenario ? <p>{scenario.poolShuffle.statement}</p> : null}
                        {scenario?.conversions.length ? (
                          <p className="mt-1">
                            {scenario.conversions.map((entry) => `${entry.securityId} converts ${BASIS[entry.basis as keyof typeof BASIS] ?? ''} into ${entry.shares} shares${entry.mfnFrom ? ` (MFN: ${entry.mfnFrom}'s terms)` : ''}`).join('; ')}.
                          </p>
                        ) : null}
                        <p className="mt-1">
                          {terms.standardPreference ? null : <Badge variant="draft">Above baseline</Badge>} {terms.liquidationPreference}
                        </p>
                        {[terms.board, terms.proRata, terms.mfn].filter(Boolean).map((line) => (
                          <p key={line} className="mt-1">
                            {line}
                          </p>
                        ))}
                        <Link href={`/deals/${dealId}/raise/investor-view?offerId=${offer.id}`} className="mt-1 inline-block font-semibold text-indigo-ink hover:underline">
                          Investor view for {offer.investorName}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Offers</CardTitle>
          <CardDescription>Every investor&apos;s bid in this round. Several may compete; none is recommended.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {offers.kind === 'ok'
            ? offers.data.items.map((offer) => (
                <form key={offer.id} action={setOfferStatus.bind(null, dealId, { ...offer })} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                  <span className="min-w-0 flex-1 font-medium">{offer.investorName}</span>
                  <select name="status" defaultValue={offer.status} aria-label={`Status of ${offer.investorName}`} className="rounded-md border border-border bg-background px-2 py-1">
                    {OFFER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" type="submit" disabled={!canEdit}>
                    Update
                  </Button>
                </form>
              ))
            : null}
          <form action={addOffer.bind(null, dealId)} className="grid gap-4 rounded-lg border border-dashed border-border p-4 sm:grid-cols-3">
            <Field label="Investor (firm or fund)" name="investorName" />
            <label className="flex flex-col gap-1 text-sm font-medium">
              Investor type
              <select name="counterpartyType" defaultValue="VC" className={inputClass}>
                {COUNTERPARTY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {COUNTERPARTY_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Status
              <select name="status" defaultValue="TERM_SHEET" className={inputClass}>
                {OFFER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <Field label={`Pre-money (${currency})`} name="preMoney" />
            <Field label={`Amount (${currency})`} name="amount" />
            <Field label="Pool target (%)" name="poolTargetPct" hint="Empty: the round's target." />
            <Field label="Liquidation preference (×)" name="liquidationMultiple" defaultValue="1" />
            <Field label="Investor board seats" name="investorBoardSeats" />
            <Field label="Received on" name="receivedOn" type="date" />
            <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="participating" /> Participating preference
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="proRata" /> Pro-rata right
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="mfn" /> Most-favoured-nation
              </label>
              <Button type="submit" disabled={!canEdit}>
                Record offer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ready for diligence?</CardTitle>
          <CardDescription>
            What {readiness.kind === 'ok' ? COUNTERPARTY_LABELS[readiness.data.counterparty as keyof typeof COUNTERPARTY_LABELS]?.toLowerCase() : 'this investor'} will ask for, against what the pact
            holds.{' '}
            {COUNTERPARTY_TYPES.map((type) => (
              <Link key={type} href={`/deals/${dealId}/raise?counterparty=${type}`} className="mr-2 font-semibold text-indigo-ink hover:underline">
                {COUNTERPARTY_LABELS[type]}
              </Link>
            ))}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {readiness.kind !== 'ok' ? (
            <ApiState result={readiness} />
          ) : (
            <>
              <p className="mb-3 font-medium">
                {readiness.data.present} of {readiness.data.total} ready{readiness.data.complete ? ' — complete' : ''}
              </p>
              <ul className="flex flex-col gap-2">
                {readiness.data.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-2">
                    <Badge variant={item.present ? 'calculation' : 'draft'}>{item.present ? 'Ready' : 'Missing'}</Badge>
                    <span>
                      <span className="font-medium">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">{item.present ? item.evidence : item.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-4">
            Every number in your deck is a claim — see the{' '}
            <Link href={`/deals/${dealId}/claims`} className="font-semibold text-indigo-ink hover:underline">
              claims register
            </Link>{' '}
            for what billing and the records verify or contradict.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
