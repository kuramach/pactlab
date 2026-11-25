import { OFFERING_EXEMPTION_LABELS, OFFERING_EXEMPTIONS, OFFERING_ITEM_KINDS, OFFERING_KIND_REGISTRY, OFFERING_SOURCE_LABELS, OFFERING_SOURCES, type OfferingItemKind, type OfferingSource } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addItem, decideItem, readDocument, runChecks, saveOffering } from './actions';

type ClaimStatus = 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED';
interface Item {
  id: string;
  kind: OfferingItemKind;
  group: 'TERM' | 'CLAIM';
  kindLabel: string;
  source: OfferingSource;
  sourceLabel: string;
  label: string | null;
  value: string | null;
  hurdle: string | null;
  status: 'PROPOSED' | 'CONFIRMED' | 'REJECTED';
  origin: 'AI' | 'PERSON';
  citation: { documentId: string; documentName: string | null; pageNumber: number; quote: string; valid: boolean };
  check: { status: ClaimStatus; rationale: string } | null;
}
interface Returns {
  irr: string | null;
  equityMultiple: string;
  averageCashOnCash: string;
  contributed: string;
  distributed: string;
}
interface Scenario {
  scenario: 'DOWNSIDE' | 'BASE' | 'UPSIDE';
  noiGrowthPct: string;
  exitCapPct: string;
  result: { version: string; limitedPartners: Returns; fees: { total: string }; sponsor: { promote: string }; sale: { salePrice: string }; conventions: string[] } | null;
  error: string | null;
}
type Offering = Record<'purchasePrice' | 'loanAmount' | 'interestRatePct' | 'equityRaise' | 'sellingCostsPct' | 'downsideNoiGrowthPct' | 'baseNoiGrowthPct' | 'upsideNoiGrowthPct' | 'downsideExitCapPct' | 'baseExitCapPct' | 'upsideExitCapPct', string> & {
  currency: string;
  holdYears: number;
  noiYear1: string | null;
  exemption: string;
};
interface SyndicationView {
  guardrail: string;
  scenarioLabel: string;
  currency: string;
  canEdit: boolean;
  offering: Offering | null;
  documents: { id: string; fileName: string; category: string | null; source: OfferingSource | null }[];
  items: Item[];
  trackRecord: { evidenceId: string; deal: string; units: string | null; status: string | null; acquiredOn: string | null; exitedOn: string | null; projectedIrrPct: string | null; actualIrrPct: string | null; projectedMultiple: string | null; actualMultiple: string | null }[];
  waterfall: { scenarios: Scenario[]; missing: string[]; unmodelled: string[]; noi: string | null; noiSource: 'ENTERED' | 'T12' | null; unavailable: string | null };
  checks: { pending: { key: string; title: string }[] };
}

const OUTCOMES: Record<string, string> = {
  'ok-offering': 'Offering saved. The waterfall below is recomputed from it.',
  'ok-confirmed': 'Confirmed. Confirmed items feed the waterfall and the offering checks.',
  'ok-rejected': 'Rejected. It no longer counts anywhere.',
  'ok-added': 'Recorded and confirmed, with its citation.',
  figure: 'Every figure must be written in the quoted text. Check the figure against the quote.',
  citation: 'That quote is not on the cited page. Copy it exactly from the document.',
  page: 'That document page is not available. Check the document and page number.',
  'not-citable': 'That document cannot be cited for the offering (people or restricted data).',
  'not-for-ai': 'That document is kept away from AI. Enter its terms by hand below.',
  loan: 'The loan must be below the purchase price.',
  label: 'A named fee or a prior deal needs its name; other items take none.',
  hurdle: 'Only a promote tier has an IRR hurdle.',
  value: 'Give the figure the document states.',
  'ai-unavailable': 'AI is not available right now, so nothing was read and nothing was lost. Try again later, or enter the terms by hand below.',
};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const read = outcome?.match(/^ok-read-(\d+)-(\d+)$/);
  if (read) return { [read[0]]: `Read. ${read[1]} new item${read[1] === '1' ? '' : 's'} to confirm${read[2] !== '0' ? `; ${read[2]} dropped because the figure or quote was not on the page` : ''}.` };
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings; claim outcomes are on Seller statements. A person decides each one.` };
  return OUTCOMES;
};
const CLAIM_TONE = { VERIFIED: 'reviewed', CONTRADICTED: 'danger', UNVERIFIED: 'draft' } as const;
const SCENARIO_NAMES = { DOWNSIDE: 'Downside', BASE: 'Base', UPSIDE: 'Upside' } as const;
const grouped = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '', fraction] = value.replace('-', '').split('.');
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction && /[1-9]/.test(fraction) ? `.${fraction}` : ''}`;
};
const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';
const figure = (item: Pick<Item, 'kind' | 'value' | 'hurdle'>) => {
  if (item.value === null) return '—';
  const unit = OFFERING_KIND_REGISTRY[item.kind].unit === 'MULTIPLE' ? '×' : '%';
  return OFFERING_KIND_REGISTRY[item.kind].tier ? `${item.value}% to the sponsor ${item.hurdle === null ? 'thereafter' : `until a ${item.hurdle}% investor IRR`}` : `${item.value}${unit}`;
};

/**
 * Multifamily syndication, the sponsor's side (T-106): the offering, the terms and claims read from
 * the PPM, operating agreement and deck (AI proposes, the sponsor confirms), the track record and
 * the waterfall recomputed from the agreement. Diligence support only; never shown to the seller.
 */
export default async function SyndicationPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const raw = (await searchParams)['outcome'];
  const outcome = typeof raw === 'string' ? raw : undefined;
  const result = await apiGet<SyndicationView>(`/v1/deals/${dealId}/syndication`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : `${view.currency} ${grouped(value)}`);
  const proposed = view.items.filter((item) => item.status === 'PROPOSED');
  const decided = view.items.filter((item) => item.status !== 'PROPOSED');
  const base = view.waterfall.scenarios.find((scenario) => scenario.scenario === 'BASE');
  const stated = (kind: OfferingItemKind) => view.items.filter((item) => item.kind === kind && item.status === 'CONFIRMED');
  const source = (item: Item) => (
    <span className="text-muted-foreground">
      <Link className="underline" href={`/deals/${dealId}/documents?documentId=${item.citation.documentId}&page=${item.citation.pageNumber}`}>
        {item.citation.documentName ?? item.sourceLabel} p.{item.citation.pageNumber}
      </Link>
      : “{item.citation.quote}” {item.citation.valid ? null : <Badge variant="danger">quote no longer on the page</Badge>}
    </span>
  );
  const offering = view.offering;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} Only you and your team see this page; the seller never does.
      </p>

      <Section title="The offering">
        {view.canEdit ? (
          <form action={saveOffering.bind(null, dealId)} className="grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="currency" value={offering?.currency ?? view.currency} />
            <Field label={`Purchase price (${view.currency})`} name="purchasePrice" value={offering?.purchasePrice} />
            <Field label={`Loan (${view.currency})`} name="loanAmount" value={offering?.loanAmount} />
            <Field label="Interest rate (%)" name="interestRatePct" value={offering?.interestRatePct} />
            <Field label={`Equity raised (${view.currency})`} name="equityRaise" value={offering?.equityRaise} />
            <Field label="Hold (years)" name="holdYears" value={offering ? String(offering.holdYears) : undefined} />
            <Field label="Selling costs (%)" name="sellingCostsPct" value={offering?.sellingCostsPct} />
            <Field label={`Year-1 NOI (${view.currency}); empty uses the T-12`} name="noiYear1" value={offering?.noiYear1 ?? undefined} required={false} />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Exemption
              <select name="exemption" defaultValue={offering?.exemption ?? 'RULE_506B'} className={inputClass}>
                {OFFERING_EXEMPTIONS.map((exemption) => (
                  <option key={exemption} value={exemption}>
                    {OFFERING_EXEMPTION_LABELS[exemption]}
                  </option>
                ))}
              </select>
            </label>
            <span />
            {(['downside', 'base', 'upside'] as const).map((path) => (
              <fieldset key={path} className="grid grid-cols-2 gap-2 rounded-md border border-border p-2">
                <legend className="px-1 text-xs text-muted-foreground">{SCENARIO_NAMES[path.toUpperCase() as keyof typeof SCENARIO_NAMES]} path</legend>
                <Field label="NOI growth (%)" name={`${path}NoiGrowthPct`} value={offering?.[`${path}NoiGrowthPct`]} />
                <Field label="Exit cap rate (%)" name={`${path}ExitCapPct`} value={offering?.[`${path}ExitCapPct`]} />
              </fieldset>
            ))}
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Save the offering
              </Button>
            </div>
          </form>
        ) : offering ? (
          <p>
            {money(offering.purchasePrice)} price, {money(offering.loanAmount)} loan, {money(offering.equityRaise)} raised, {offering.holdYears}-year hold.
          </p>
        ) : (
          <p className="text-muted-foreground">Not entered yet.</p>
        )}
      </Section>

      <Section title="Read the offering documents">
        <p className="text-muted-foreground">AI reads a PPM, operating agreement or investor deck and proposes the fees, distribution terms and claims it states, each with its exact quote. Nothing counts until you confirm it.</p>
        {view.documents.length === 0 ? <p className="text-muted-foreground">No documents yet. Upload the PPM, operating agreement and deck on Documents.</p> : null}
        <ul className="flex flex-col gap-2">
          {view.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-64">{document.fileName}</span>
              {view.canEdit ? (
                <form action={readDocument.bind(null, dealId, document.id)} className="flex items-center gap-2">
                  <select name="source" defaultValue={document.source ?? 'PPM'} aria-label={`What ${document.fileName} is`} className={inputClass}>
                    {OFFERING_SOURCES.map((value) => (
                      <option key={value} value={value}>
                        {OFFERING_SOURCE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="outline">
                    Read with AI
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`To confirm (${proposed.length})`}>
        {proposed.length === 0 ? <p className="text-muted-foreground">Nothing waiting.</p> : null}
        {proposed.map((item) => (
          <div key={item.id} className="flex flex-col gap-1 border-t border-border pt-2">
            <div>
              <Badge variant="draft">AI proposed</Badge> <strong>{item.kindLabel}</strong>
              {item.label ? `: ${item.label}` : ''} — {figure(item)} <span className="text-xs text-muted-foreground">({item.sourceLabel})</span>
            </div>
            {source(item)}
            {view.canEdit ? (
              <form action={decideItem.bind(null, dealId, item.id)} className="flex flex-wrap items-center gap-2">
                <input name="value" defaultValue={item.value ?? ''} aria-label={`${item.kindLabel} figure`} className={`${inputClass} w-24`} />
                {OFFERING_KIND_REGISTRY[item.kind].tier ? <input name="hurdle" defaultValue={item.hurdle ?? ''} placeholder="Hurdle (empty: last tier)" aria-label={`${item.kindLabel} hurdle`} className={`${inputClass} w-40`} /> : null}
                <input name="note" placeholder="Note (optional)" aria-label="Note" className={`${inputClass} w-64`} />
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

      <Section title="Waterfall check (stated vs recomputed)">
        {view.waterfall.unavailable ? (
          <p className="text-muted-foreground">{view.waterfall.unavailable}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {view.scenarioLabel} Recomputed from the operating agreement&apos;s confirmed terms with {base?.result?.version ?? 'the waterfall'}; year-1 NOI {money(view.waterfall.noi)} ({view.waterfall.noiSource === 'T12' ? 'from the T-12' : 'as entered'}).
              {view.waterfall.unmodelled.length > 0 ? ` Not modelled: ${view.waterfall.unmodelled.join(', ')}.` : ''}
            </p>
            <table className="w-full text-left">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Investor return</th>
                  <th className="py-1">Stated in the offering</th>
                  {view.waterfall.scenarios.map((scenario) => (
                    <th key={scenario.scenario} className="py-1 text-right">
                      {SCENARIO_NAMES[scenario.scenario]} ({scenario.noiGrowthPct}% NOI growth, {scenario.exitCapPct}% exit cap)
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['IRR', 'PROJECTED_IRR', (r: Returns) => (r.irr === null ? '—' : `${r.irr}%`)],
                    ['Equity multiple', 'EQUITY_MULTIPLE', (r: Returns) => `${r.equityMultiple}×`],
                    ['Average cash-on-cash', 'CASH_ON_CASH', (r: Returns) => `${r.averageCashOnCash}%`],
                  ] as const
                ).map(([label, kind, show]) => (
                  <tr key={kind} className="border-t border-border align-top">
                    <td className="py-1">{label}</td>
                    <td className="py-1">
                      {stated(kind).length === 0
                        ? '—'
                        : stated(kind).map((item) => (
                            <div key={item.id}>
                              {figure(item)} ({item.sourceLabel}) {item.check ? <Badge variant={CLAIM_TONE[item.check.status]}>{item.check.status.toLowerCase()}</Badge> : null}
                            </div>
                          ))}
                    </td>
                    {view.waterfall.scenarios.map((scenario) => (
                      <td key={scenario.scenario} className="py-1 text-right tabular-nums">
                        {scenario.result ? show(scenario.result.limitedPartners) : <span className="text-muted-foreground">{scenario.error}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {base?.result ? (
              <details className="text-xs">
                <summary className="cursor-pointer">Conventions</summary>
                <ul className="mt-1 list-disc pl-5">
                  {base.result.conventions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
        {view.canEdit ? (
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit" size="sm">
              Run offering checks
            </Button>
          </form>
        ) : null}
        {view.checks.pending.length > 0 ? (
          <p className="text-muted-foreground">
            The checks would draft: {view.checks.pending.map((check) => check.title).join('; ')}. See them on <Link className="underline" href={`/deals/${dealId}/findings`}>Findings</Link> once run.
          </p>
        ) : null}
      </Section>

      <Section title="Sponsor track record">
        {view.trackRecord.length === 0 ? (
          <p className="text-muted-foreground">No track record imported. Import the sponsor&apos;s prior deals on Sources (Industry data → Sponsor track record). A missing track record is a gap investors will ask about.</p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Prior deal</th>
                <th className="py-1">Status</th>
                <th className="py-1 text-right">Projected IRR</th>
                <th className="py-1 text-right">Actual IRR</th>
                <th className="py-1 text-right">Projected multiple</th>
                <th className="py-1 text-right">Actual multiple</th>
              </tr>
            </thead>
            <tbody>
              {view.trackRecord.map((row) => (
                <tr key={row.evidenceId} className="border-t border-border">
                  <td className="py-1">
                    <Link className="underline" href={`/deals/${dealId}/evidence/${row.evidenceId}`}>
                      {row.deal}
                    </Link>
                  </td>
                  <td className="py-1">{row.status ?? '—'}</td>
                  <td className="py-1 text-right tabular-nums">{row.projectedIrrPct ? `${row.projectedIrrPct}%` : '—'}</td>
                  <td className="py-1 text-right tabular-nums">{row.actualIrrPct ? `${row.actualIrrPct}%` : <span className="text-muted-foreground">not documented</span>}</td>
                  <td className="py-1 text-right tabular-nums">{row.projectedMultiple ? `${row.projectedMultiple}×` : '—'}</td>
                  <td className="py-1 text-right tabular-nums">{row.actualMultiple ? `${row.actualMultiple}×` : <span className="text-muted-foreground">not documented</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Terms and claims">
        {decided.length === 0 ? <p className="text-muted-foreground">Nothing confirmed yet.</p> : null}
        {(['TERM', 'CLAIM'] as const).map((group) => {
          const rows = decided.filter((item) => item.group === group);
          if (rows.length === 0) return null;
          return (
            <table key={group} className="w-full text-left">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">{group === 'TERM' ? 'Term' : 'Claim'}</th>
                  <th className="py-1">Figure</th>
                  <th className="py-1">Where</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className="border-t border-border align-top">
                    <td className="py-1">
                      {item.kindLabel}
                      {item.label ? `: ${item.label}` : ''}
                    </td>
                    <td className="py-1">{figure(item)}</td>
                    <td className="py-1">{source(item)}</td>
                    <td className="py-1">
                      {item.status === 'REJECTED' ? <Badge variant="neutral">rejected</Badge> : item.check ? <Badge variant={CLAIM_TONE[item.check.status]}>{item.check.status.toLowerCase()}</Badge> : <Badge variant="calculation">confirmed</Badge>}
                      {item.check && item.status !== 'REJECTED' ? <div className="text-xs text-muted-foreground">{item.check.rationale}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}
      </Section>

      {view.canEdit ? (
        <Section title="Enter a term or claim by hand">
          <form action={addItem.bind(null, dealId)} className="grid gap-2 sm:grid-cols-3">
            <select name="kind" aria-label="Kind" className={inputClass}>
              {OFFERING_ITEM_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {OFFERING_KIND_REGISTRY[kind].label}
                </option>
              ))}
            </select>
            <select name="source" aria-label="Source document" className={inputClass}>
              {OFFERING_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {OFFERING_SOURCE_LABELS[value]}
                </option>
              ))}
            </select>
            <input name="label" placeholder="Fee or prior-deal name (only those kinds)" aria-label="Name" className={inputClass} />
            <input name="value" placeholder="Figure, e.g. 8 or 1.85" aria-label="Figure" className={inputClass} />
            <input name="hurdle" placeholder="Hurdle IRR (promote tiers only)" aria-label="Hurdle" className={inputClass} />
            <span />
            <select name="documentId" required aria-label="Document" className={inputClass}>
              {view.documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.fileName}
                </option>
              ))}
            </select>
            <input name="pageNumber" type="number" min={1} required placeholder="Page" aria-label="Page" className={inputClass} />
            <input name="quote" required placeholder="Exact quote holding the figure" aria-label="Quote" className={inputClass} />
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" variant="outline">
                Record and confirm
              </Button>
            </div>
          </form>
        </Section>
      ) : null}
    </div>
  );
}

function Field({ label, name, value, required = true }: { label: string; name: string; value: string | undefined; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input name={name} defaultValue={value ?? ''} required={required} className={inputClass} />
    </label>
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
