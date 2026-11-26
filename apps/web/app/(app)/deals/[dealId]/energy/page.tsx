import type { Page } from '@pactlab/contracts';
import { ENERGY_ITEM_KINDS, ENERGY_ITEM_REGISTRY, type EnergyItemKind } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../../_components/pager';
import { formatRatio } from '../../../metrics/_lib/format';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addItem, decideItem, readDocument, runChecks } from './actions';

interface Source {
  documentId: string;
  documentName: string | null;
  pageNumber: number;
  quote: string;
}
interface EnergyView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canEdit: boolean;
  register: { plants: number; interests: number; leases: number; productionLines: number; scheduleLines: number; confirmedEntries: number; corroboratedEntries: number; proposedEntries: number };
  production: { analysisDate: string | null; interestTrailingBoe: string; interestPriorBoe: string; interestDecline: string | null; interestTrailingRevenue: string; plantTrailingRevenue: string; contractedShare: string | null; capacityMw: string; capacityKw: string; conventions: string[] };
  reserves: { reportOnFile: boolean; categories: { category: string; label: string; volume: string | null; value: string | null }[]; assumedDecline: { percent: string; source: Source | null } | null; actualDecline: string | null; mismatch: boolean; thresholdPoints: string };
  decimals: { checked: number; errors: { interestId: string; name: string; leaseId: string; stated: string; computed: string; direction: 'OVERPAID' | 'UNDERPAID'; yearly: string }[]; conventions: string[] };
  leases: { analysisDate: string | null; holdYears: number; holdSource: 'CHOSEN' | 'STATED' | 'DEFAULT'; holdEnds: string | null; totalAcres: string; exposedAcres: string; share: string | null; material: boolean; threshold: string; exposed: { leaseId: string; netAcres: string; expiresOn: string }[]; exposedCount: number; lapsed: string[]; conventions: string[] };
  ppa: { plantId: string; name: string; expiresOn: string; counterparty: string | null; trailingRevenue: string; contractedRevenue: string; contractedShare: string | null }[];
  liabilities: {
    lines: { kind: string; label: string; assetId: string | null; assetName: string | null; estimate: string; booked: string; gap: string; status: 'UNBOOKED' | 'SHORTFALL' | 'COVERED'; sources: Source[] }[];
    bookedTotal: string;
    estimateTotal: string;
    bookedOnly: { kind: string; assetId: string | null; description: string | null; booked: string }[];
    aroMargin: string;
    conventions: string[];
  };
  documents: { id: string; fileName: string; category: string | null; energy: boolean }[];
}
interface AssetRow {
  assetId: string;
  family: 'PLANT' | 'INTEREST';
  name: string;
  plant: { fuel: string; capacityMw: string; commissionedYear: number | null; reportedCapacityFactor: string | null; computedCapacityFactor: string | null; ppaCounterparty: string | null; ppaExpiresOn: string | null; contractedShare: string | null } | null;
  interest: { type: string; legalDescription: string | null; leaseId: string; operator: string | null; share: string; divisionOrderNri: string | null; recomputedNri: string | null; decimalOff: boolean; heldByProduction: boolean | null; leaseExpiresOn: string | null; trailingBoe: string; decline: string | null } | null;
  trailingRevenue: string;
}
interface Item {
  id: string;
  kind: EnergyItemKind;
  kindLabel: string;
  asset: string | null;
  detail: string | null;
  value: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'REJECTED';
  origin: 'AI' | 'PERSON';
  citation: Source & { valid: boolean };
}

const OUTCOMES: Record<string, string> = {
  'ok-confirmed': 'Confirmed. Confirmed entries join the reserves, decline and liability models and the energy checks.',
  'ok-rejected': 'Rejected. It no longer counts anywhere.',
  'ok-added': 'Recorded and confirmed, with its citation.',
  figure: 'The figure must be written in the quoted text. Check it against the quote.',
  citation: 'That quote is not on the cited page. Copy it exactly from the document.',
  page: 'That document page is not available. Check the document and page number.',
  'not-citable': 'That document cannot be cited for the register (people or restricted data).',
  'not-for-ai': 'That document is kept away from AI. Enter its entries by hand below.',
  detail: 'Give the reserve category (PDP, PDNP, PUD) or the obligation (remediation, ccr, reclamation, aro) the entry needs; a decline has none.',
  value: 'Give the figure the document states (a decline is at most 100%).',
  'ai-unavailable': 'AI is not available right now, so nothing was read and nothing was lost. Try again later, or enter the entries by hand below.',
};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const read = outcome?.match(/^ok-read-(\d+)-(\d+)$/);
  if (read) return { [read[0]]: `Read. ${read[1]} new entr${read[1] === '1' ? 'y' : 'ies'} to confirm${read[2] !== '0' ? `; ${read[2]} dropped because the figure or quote was not on the page` : ''}.` };
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` };
  return OUTCOMES;
};
const grouped = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '', fraction] = value.replace('-', '').split('.');
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction && /[1-9]/.test(fraction) ? `.${fraction}` : ''}`;
};
const percent = (fraction: string | null) => formatRatio(fraction);
const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';
const HOLD_SOURCES = { CHOSEN: 'the hold you chose', STATED: 'the hold a document states', DEFAULT: 'the pack’s default hold' } as const;
const STATUS = { UNBOOKED: 'Not booked', SHORTFALL: 'Booked short', COVERED: 'Covered' } as const;

/**
 * Energy generation & rights (T-142): the plant and interest register, production and the decline
 * against the reserve report, reserves as the report states them, division-order decimals, lease
 * expiry, PPA coverage and the liability model — all from imports, the entries a person confirmed
 * from reports and cited document sentences. Diligence support only; the buyer's own side.
 */
export default async function EnergyPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const holdRaw = typeof search['hold'] === 'string' ? search['hold'] : '';
  const hold = /^\d{1,2}$/.test(holdRaw) && Number(holdRaw) >= 1 && Number(holdRaw) <= 30 ? holdRaw : '';
  const holdQuery = hold ? `holdYears=${hold}` : '';
  const assetsAt = readPage(search, 'assets');
  const entriesAt = readPage(search, 'entries');
  const [result, assets, entries, proposedResult] = await Promise.all([
    apiGet<EnergyView>(`/v1/deals/${dealId}/energy${holdQuery ? `?${holdQuery}` : ''}`),
    apiGet<Page<AssetRow>>(`/v1/deals/${dealId}/energy/assets?${[holdQuery, pageApiQuery(assetsAt, 25)].filter(Boolean).join('&')}`),
    apiGet<Page<Item>>(`/v1/deals/${dealId}/energy/items?${pageApiQuery(entriesAt, 25)}`),
    apiGet<Page<Item>>(`/v1/deals/${dealId}/energy/items?status=PROPOSED&limit=50`),
  ]);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : `${view.currency} ${grouped(value)}`);
  const base = `/deals/${dealId}/energy`;
  const proposed = proposedResult.kind === 'ok' ? proposedResult.data.items : [];
  const cite = (source: Source) => (
    <Link key={`${source.documentId}:${source.pageNumber}:${source.quote}`} className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const itemSource = (item: Item) => (
    <span className="text-muted-foreground">
      {cite(item.citation)}: “{item.citation.quote}” {item.citation.valid ? null : <Badge variant="danger">quote no longer on the page</Badge>}
    </span>
  );
  const reading = (item: Item) => {
    const definition = ENERGY_ITEM_REGISTRY[item.kind];
    const value = definition.value === 'PERCENT' ? `${item.value}%` : definition.value === 'VOLUME' ? `${grouped(item.value)} MBOE` : money(item.value);
    return [item.asset, item.detail, value].filter(Boolean).join(' · ');
  };

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Plants and production">
        {view.production.analysisDate === null ? (
          <p className="text-muted-foreground">No production history yet. Import the plant and interest registers, lease schedule, production history and liability schedule on Sources (Industry data).</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label="Net capacity" value={`${grouped(view.production.capacityMw)} MW`} />
              <Figure label={`Plant revenue (to ${view.production.analysisDate})`} value={money(view.production.plantTrailingRevenue)} />
              <Figure label="Contract coverage" value={percent(view.production.contractedShare)} />
              <Figure label="Interest production, trailing" value={`${grouped(view.production.interestTrailingBoe)} BOE`} />
              <Figure label="Prior year" value={`${grouped(view.production.interestPriorBoe)} BOE`} />
              <Figure label="Annual decline (actual)" value={percent(view.production.interestDecline)} />
              <Figure label="Interest revenue, gross (8/8ths)" value={money(view.production.interestTrailingRevenue)} />
              <Figure label="Capacity for $/kW (kW)" value={grouped(view.production.capacityKw)} />
            </dl>
            {view.ppa.length ? (
              <p>
                <Badge variant="danger">PPA cliff</Badge>{' '}
                {view.ppa.map((cliff) => `${cliff.name}: the PPA${cliff.counterparty ? ` with ${cliff.counterparty}` : ''} ends ${cliff.expiresOn}, inside the hold; ${percent(cliff.contractedShare)} of its revenue (${money(cliff.contractedRevenue)}) turns merchant`).join('; ')}.
              </p>
            ) : (
              <p className="text-muted-foreground">No PPA ends inside the {view.leases.holdYears}-year hold.</p>
            )}
            <Conventions items={view.production.conventions} />
          </>
        )}
      </Section>

      <Section title="Reserves (third-party report)">
        {!view.reserves.reportOnFile ? (
          <p>
            <Badge variant="danger">No reserve report</Badge> No third-party reserve report is in the evidence. Pactlab never estimates reserves: ask the seller for the engineering report.
          </p>
        ) : null}
        <table className="w-full text-left">
          <caption className="sr-only">Reserves by category as the report states them</caption>
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col">Category</th>
              <th scope="col" className="text-right">Net reserves</th>
              <th scope="col" className="text-right">Discounted value</th>
            </tr>
          </thead>
          <tbody>
            {view.reserves.categories.map((category) => (
              <tr key={category.category} className="border-t border-border">
                <td>
                  {category.category} <span className="text-xs text-muted-foreground">{category.label}</span>
                </td>
                <td className="text-right" data-numeric>{category.volume === null ? 'not confirmed' : `${grouped(category.volume)} MBOE`}</td>
                <td className="text-right" data-numeric>{category.value === null ? 'not confirmed' : money(category.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          {view.reserves.mismatch ? <Badge variant="danger">Decline mismatch</Badge> : <Badge variant="reviewed">Within {view.reserves.thresholdPoints} points</Badge>} Actual decline {percent(view.reserves.actualDecline)} against the{' '}
          {view.reserves.assumedDecline ? `${view.reserves.assumedDecline.percent}%` : 'unstated'} the report assumes
          {view.reserves.assumedDecline?.source ? <> ({cite(view.reserves.assumedDecline.source)})</> : null}.
        </p>
      </Section>

      <Section title="Liabilities: evidence against the seller’s schedule">
        {view.liabilities.lines.length === 0 ? <p className="text-muted-foreground">No liability estimate in the reports or confirmed entries yet.</p> : null}
        {view.liabilities.lines.length ? (
          <table className="w-full text-left">
            <caption className="sr-only">Obligations: the evidence estimate against the booked figure</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Obligation</th>
                <th scope="col" className="text-right">Evidence estimate</th>
                <th scope="col" className="text-right">Booked</th>
                <th scope="col" className="text-right">Gap</th>
                <th scope="col">Status</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {view.liabilities.lines.map((line) => (
                <tr key={`${line.kind}:${line.assetId ?? ''}`} className="border-t border-border align-top">
                  <td>
                    {line.label} <span className="text-xs text-muted-foreground">{line.assetName ?? 'portfolio'}</span>
                  </td>
                  <td className="text-right" data-numeric>{money(line.estimate)}</td>
                  <td className="text-right" data-numeric>{money(line.booked)}</td>
                  <td className="text-right" data-numeric>{money(line.gap)}</td>
                  <td>{line.status === 'COVERED' ? STATUS.COVERED : <Badge variant="danger">{STATUS[line.status]}</Badge>}</td>
                  <td className="flex flex-wrap gap-2 text-xs">{line.sources.map(cite)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="text-muted-foreground">
          Booked on the schedule: {money(view.liabilities.bookedTotal)} across {view.register.scheduleLines} lines; {view.liabilities.bookedOnly.length} of them have no estimate in the evidence. The ARO is flagged short beyond a {percent(view.liabilities.aroMargin)} margin.
        </p>
        <Conventions items={view.liabilities.conventions} />
      </Section>

      <Section title="Leases and decimals">
        <form className="flex flex-wrap items-end gap-2" action={base}>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Hold period (years)
            <input name="hold" defaultValue={hold || String(view.leases.holdYears)} inputMode="numeric" className={`${inputClass} w-24`} />
          </label>
          <Button type="submit" size="sm" variant="outline">
            Recompute
          </Button>
          <span className="text-xs text-muted-foreground">Now using {HOLD_SOURCES[view.leases.holdSource]} of {view.leases.holdYears} years, to {view.leases.holdEnds ?? '—'}.</span>
        </form>
        <p>
          {view.leases.material ? <Badge variant="danger">Material</Badge> : <Badge variant="reviewed">Below {percent(view.leases.threshold)}</Badge>} <strong>{percent(view.leases.share)}</strong> of the net acres ({grouped(view.leases.exposedAcres)} of {grouped(view.leases.totalAcres)}) are not held by production and expire inside the hold
          {view.leases.exposed.length ? `: ${view.leases.exposed.map((lease) => `${lease.leaseId} (${grouped(lease.netAcres)} acres, ${lease.expiresOn})`).join('; ')}` : ''}.
          {view.leases.lapsed.length ? ` Already past the primary term: ${view.leases.lapsed.join(', ')}.` : ''}
        </p>
        {view.decimals.errors.length ? (
          <table className="w-full text-left">
            <caption className="text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">Division-order decimals off the lease chain ({view.decimals.errors.length} of {view.decimals.checked})</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Interest</th>
                <th scope="col" className="text-right">Division order</th>
                <th scope="col" className="text-right">Lease chain</th>
                <th scope="col">Direction</th>
                <th scope="col" className="text-right">A year</th>
              </tr>
            </thead>
            <tbody>
              {view.decimals.errors.map((check) => (
                <tr key={check.interestId} className="border-t border-border">
                  <td>
                    {check.name} <span className="text-xs text-muted-foreground">{check.interestId} · {check.leaseId}</span>
                  </td>
                  <td className="text-right" data-numeric>{check.stated}</td>
                  <td className="text-right" data-numeric>{check.computed}</td>
                  <td>
                    <Badge variant={check.direction === 'OVERPAID' ? 'danger' : 'draft'}>{check.direction === 'OVERPAID' ? 'Overpaid' : 'Underpaid'}</Badge>
                  </td>
                  <td className="text-right" data-numeric>{money(check.yearly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted-foreground">All {view.decimals.checked} division-order decimals agree with the lease chain.</p>
        )}
        <Conventions items={[...view.leases.conventions, ...view.decimals.conventions]} />
      </Section>

      <Section title={`Asset and interest register (${view.register.plants} plants, ${view.register.interests} interests, ${view.register.leases} leases)`}>
        {assets.kind !== 'ok' ? (
          <ApiState result={assets} />
        ) : assets.data.items.length === 0 ? (
          <p className="text-muted-foreground">No assets yet. Import the plant and interest registers on Sources (Industry data).</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Plants and interests</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Asset</th>
                  <th scope="col">Detail</th>
                  <th scope="col" className="text-right">Trailing revenue</th>
                  <th scope="col">Checks</th>
                </tr>
              </thead>
              <tbody>
                {assets.data.items.map((asset) => (
                  <tr key={asset.assetId} className="border-t border-border align-top">
                    <td>
                      {asset.name} <span className="text-xs text-muted-foreground">{asset.assetId}</span>
                    </td>
                    <td>
                      {asset.plant
                        ? `${asset.plant.fuel}, ${asset.plant.capacityMw} MW, since ${asset.plant.commissionedYear ?? '—'}; capacity factor ${percent(asset.plant.computedCapacityFactor ?? asset.plant.reportedCapacityFactor)}${asset.plant.ppaExpiresOn ? `; PPA to ${asset.plant.ppaExpiresOn}` : '; merchant'}`
                        : asset.interest
                          ? `${asset.interest.type} ${asset.interest.share} on ${asset.interest.leaseId}; ${grouped(asset.interest.trailingBoe)} BOE, decline ${percent(asset.interest.decline)}`
                          : null}
                    </td>
                    <td className="text-right" data-numeric>{money(asset.trailingRevenue)}</td>
                    <td>
                      {asset.interest?.decimalOff ? <Badge variant="danger">decimal {asset.interest.divisionOrderNri} vs {asset.interest.recomputedNri}</Badge> : null}{' '}
                      {asset.interest && asset.interest.heldByProduction === false ? <Badge variant="draft">not held by production{asset.interest.leaseExpiresOn ? `, to ${asset.interest.leaseExpiresOn}` : ''}</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager label="Asset pages" base={base} links={pagerLinks({ ...assets.data, itemCount: assets.data.items.length }, assetsAt, keepParams(search), 'assets')} />
          </>
        )}
      </Section>

      <Section title="Read the reports">
        <p className="text-muted-foreground">AI reads a third-party reserve report, an environmental report or a permit and proposes the reserves, the decline it assumes and the liability estimates it states, each with its exact quote. Nothing counts until you confirm it.</p>
        {view.documents.length === 0 ? <p className="text-muted-foreground">No documents yet. Upload the reports on Documents.</p> : null}
        <ul className="flex flex-col gap-2">
          {view.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-64">{document.fileName}</span>
              {document.energy ? <Badge variant="reviewed">energy document</Badge> : null}
              {view.canEdit ? (
                <form action={readDocument.bind(null, dealId, document.id)}>
                  <Button type="submit" size="sm" variant="outline">
                    Read with AI
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`To confirm (${view.register.proposedEntries})`}>
        {proposed.length === 0 ? <p className="text-muted-foreground">Nothing waiting.</p> : null}
        {proposed.map((item) => (
          <div key={item.id} className="flex flex-col gap-1 border-t border-border pt-2">
            <div>
              <Badge variant="draft">AI proposed</Badge> <strong>{item.kindLabel}</strong> — {reading(item)}
            </div>
            {itemSource(item)}
            {view.canEdit ? (
              <form action={decideItem.bind(null, dealId, item.id)} className="flex flex-wrap items-center gap-2">
                <input name="asset" defaultValue={item.asset ?? ''} aria-label="Asset" placeholder="Asset (optional)" className={`${inputClass} w-48`} />
                {ENERGY_ITEM_REGISTRY[item.kind].detail ? <input name="detail" defaultValue={item.detail ?? ''} aria-label={ENERGY_ITEM_REGISTRY[item.kind].detail?.label ?? 'Detail'} className={`${inputClass} w-32`} /> : null}
                <input name="value" defaultValue={item.value} aria-label="Figure" className={`${inputClass} w-32`} />
                <input name="note" placeholder="Note (optional)" aria-label="Note" className={`${inputClass} w-56`} />
                <Button type="submit" size="sm" name="decision" value="CONFIRM">
                  Confirm
                </Button>
                <Button type="submit" size="sm" variant="outline" name="decision" value="REJECT">
                  Reject
                </Button>
              </form>
            ) : null}
          </div>
        ))}
      </Section>

      <Section title={`Entries from reports (${view.register.confirmedEntries} confirmed, ${view.register.corroboratedEntries} restating a report sentence)`}>
        {entries.kind !== 'ok' ? (
          <ApiState result={entries} />
        ) : entries.data.items.length === 0 ? (
          <p className="text-muted-foreground">None yet. Read a report above, or enter an entry by hand below.</p>
        ) : (
          <>
            {entries.data.items.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 border-t border-border pt-2">
                <div>
                  <Badge variant={item.status === 'CONFIRMED' ? 'reviewed' : item.status === 'REJECTED' ? 'danger' : 'draft'}>{item.status === 'CONFIRMED' ? 'Confirmed' : item.status === 'REJECTED' ? 'Rejected' : 'To confirm'}</Badge> <strong>{item.kindLabel}</strong> — {reading(item)}{' '}
                  <span className="text-xs text-muted-foreground">({item.origin === 'AI' ? 'read by AI' : 'entered by a person'})</span>
                </div>
                {itemSource(item)}
              </div>
            ))}
            <Pager label="Entry pages" base={base} links={pagerLinks({ ...entries.data, itemCount: entries.data.items.length }, entriesAt, keepParams(search), 'entries')} />
          </>
        )}
        {view.canEdit ? (
          <details>
            <summary className="cursor-pointer font-medium">Enter an entry by hand</summary>
            <form action={addItem.bind(null, dealId)} className="mt-2 grid gap-2 sm:grid-cols-4">
              <select name="kind" aria-label="Kind" className={inputClass}>
                {ENERGY_ITEM_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {ENERGY_ITEM_REGISTRY[kind].label}
                  </option>
                ))}
              </select>
              <select name="documentId" aria-label="Document" className={inputClass}>
                {view.documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.fileName}
                  </option>
                ))}
              </select>
              <input name="pageNumber" placeholder="Page" aria-label="Page" inputMode="numeric" className={inputClass} />
              <input name="asset" placeholder="Asset as the document names it (optional)" aria-label="Asset" className={inputClass} />
              <input name="detail" placeholder="PDP, PDNP, PUD, or remediation, ccr, reclamation, aro" aria-label="Detail" className={inputClass} />
              <input name="value" placeholder="Figure as written (12, 1240, 42000000)" aria-label="Figure" className={inputClass} />
              <textarea name="quote" placeholder="The exact quote from the page" aria-label="Quote" className={`${inputClass} sm:col-span-4`} rows={2} />
              <div>
                <Button type="submit" size="sm">
                  Record with citation
                </Button>
              </div>
            </form>
          </details>
        ) : null}
      </Section>

      {view.canEdit ? (
        <Section title="Energy checks">
          <p className="text-muted-foreground">Runs the pack&apos;s rules over the registers, production, the liability schedule, the confirmed entries and the documents: unbooked environmental liabilities, the ARO, decline, lease expiry, decimals, PPA cliffs, title, compliance capex and a missing reserve report. Drafts go to Findings; running again adds nothing already drafted.</p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run energy checks</Button>
          </form>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-navy/10 p-3">
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{label}</dt>
      <dd className="text-xl font-extrabold tracking-tight" data-numeric>
        {value}
      </dd>
    </div>
  );
}

function Conventions({ items }: { items: readonly string[] }) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">How this is computed</summary>
      <ul className="mt-1 list-disc pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
