import type { Page } from '@pactlab/contracts';
import { MUSIC_ITEM_KINDS, MUSIC_ITEM_REGISTRY, type MusicItemKind, formatAmount } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../../_components/pager';
import { formatRatio } from '../../../metrics/_lib/format';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addItem, decideItem, readDocument, runChecks } from './actions';

interface CatalogView {
  guardrail: string;
  noInventedIncome: string;
  version: string;
  currency: string;
  canEdit: boolean;
  register: { works: number; splits: number; grants: number; statementLines: number; confirmedEntries: number; corroboratedEntries: number; proposedEntries: number; withoutTitleEvidence: number };
  income: {
    latestPeriodEnd: string | null;
    periods: string[];
    trailing: string;
    prior: string;
    change: string | null;
    decayAdjusted: string;
    bySource: { source: string; label: string; amount: string }[];
    bands: { key: string; label: string; works: number; trailing: string; prior: string; change: string | null; decayAdjusted: string }[];
    conventions: string[];
    gaps: { payer: string; missing: string[] }[];
  };
  termination: {
    analysisDate: string | null;
    holdYears: number;
    holdSource: 'CHOSEN' | 'STATED' | 'DEFAULT';
    holdEnds: string | null;
    exposedIncome: string;
    share: string | null;
    material: boolean;
    threshold: string;
    grants: { workId: string; title: string; statute: string; opens: string; closes: string; share: string | null; exposedIncome: string }[];
    grantCount: number;
    undated: string[];
    conventions: string[];
  };
  documents: { id: string; fileName: string; category: string | null; rights: boolean }[];
}
interface WorkRow {
  workId: string;
  title: string;
  type: string;
  pro: string | null;
  releaseYear: number | null;
  usWork: boolean;
  trailing: string;
  share: string | null;
  title_evidence: { registration: boolean; assignment: boolean };
  splitSheetTotal: string | null;
  termination: { statute: string; opens: string; closes: string; insideHold: boolean } | null;
}
interface Item {
  id: string;
  kind: MusicItemKind;
  kindLabel: string;
  work: string | null;
  detail: string | null;
  value: string | null;
  date: string | null;
  status: 'PROPOSED' | 'CONFIRMED' | 'REJECTED';
  origin: 'AI' | 'PERSON';
  citation: { documentId: string; documentName: string | null; pageNumber: number; quote: string; valid: boolean };
}

const OUTCOMES: Record<string, string> = {
  'ok-confirmed': 'Confirmed. Confirmed entries join the register, the income model and the catalog checks.',
  'ok-rejected': 'Rejected. It no longer counts anywhere.',
  'ok-added': 'Recorded and confirmed, with its citation.',
  figure: 'Every figure and date must be written in the quoted text. Check it against the quote.',
  citation: 'That quote is not on the cited page. Copy it exactly from the document.',
  page: 'That document page is not available. Check the document and page number.',
  'not-citable': 'That document cannot be cited for the register (people or restricted data).',
  'not-for-ai': 'That document is kept away from AI. Enter its entries by hand below.',
  work: 'Name the work for a split, grant or statement line; leave it empty for a balance or a lien.',
  detail: 'Give the writer reference, grant type or income source the entry needs.',
  value: 'Give the figure the document states (a share is at most 100%).',
  date: 'Give the date the entry needs, as YYYY-MM-DD.',
  'ai-unavailable': 'AI is not available right now, so nothing was read and nothing was lost. Try again later, or enter the entries by hand below.',
};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const read = outcome?.match(/^ok-read-(\d+)-(\d+)$/);
  if (read) return { [read[0]]: `Read. ${read[1]} new entr${read[1] === '1' ? 'y' : 'ies'} to confirm${read[2] !== '0' ? `; ${read[2]} dropped because the figure or quote was not on the page` : ''}.` };
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` };
  return OUTCOMES;
};
const percent = (fraction: string | null) => formatRatio(fraction);
const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';
const HOLD_SOURCES = { CHOSEN: 'the hold you chose', STATED: 'the hold a document states', DEFAULT: 'the pack’s default hold' } as const;

/**
 * Music rights (T-140): the works and rights register, the royalty income model with decay by
 * catalog age, and the termination exposure inside the hold — all from imported register data,
 * statements and the entries a person confirmed from rights documents. Diligence support only;
 * the buyer's own side (the seller never sees this page).
 */
export default async function CatalogPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const holdRaw = typeof search['hold'] === 'string' ? search['hold'] : '';
  const hold = /^\d{1,2}$/.test(holdRaw) && Number(holdRaw) >= 1 && Number(holdRaw) <= 30 ? holdRaw : '';
  const holdQuery = hold ? `holdYears=${hold}` : '';
  const worksAt = readPage(search, 'works');
  const entriesAt = readPage(search, 'entries');
  const [result, works, entries, proposedResult] = await Promise.all([
    apiGet<CatalogView>(`/v1/deals/${dealId}/catalog${holdQuery ? `?${holdQuery}` : ''}`),
    apiGet<Page<WorkRow>>(`/v1/deals/${dealId}/catalog/works?${[holdQuery, pageApiQuery(worksAt, 25)].filter(Boolean).join('&')}`),
    apiGet<Page<Item>>(`/v1/deals/${dealId}/catalog/items?${[pageApiQuery(entriesAt, 25)].filter(Boolean).join('&')}`),
    apiGet<Page<Item>>(`/v1/deals/${dealId}/catalog/items?status=PROPOSED&limit=50`),
  ]);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : formatAmount(value, view.currency, { fraction: 'trim' }));
  const base = `/deals/${dealId}/catalog`;
  const proposed = proposedResult.kind === 'ok' ? proposedResult.data.items : [];
  const source = (item: Item) => (
    <span className="text-muted-foreground">
      <Link className="underline" href={`/deals/${dealId}/documents?documentId=${item.citation.documentId}&page=${item.citation.pageNumber}`}>
        {item.citation.documentName ?? 'Document'} p.{item.citation.pageNumber}
      </Link>
      : “{item.citation.quote}” {item.citation.valid ? null : <Badge variant="danger">quote no longer on the page</Badge>}
    </span>
  );
  const reading = (item: Item) => [item.work, item.detail, item.value !== null ? (MUSIC_ITEM_REGISTRY[item.kind].value === 'PERCENT' ? `${item.value}%` : money(item.value)) : null, item.date].filter(Boolean).join(' · ');

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedIncome} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Royalty income">
        {view.income.latestPeriodEnd === null ? (
          <p className="text-muted-foreground">No royalty statements yet. Import the statements on Sources (Industry data) to build the income model.</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label={`Trailing net income (to ${view.income.latestPeriodEnd})`} value={money(view.income.trailing)} />
              <Figure label="Prior year" value={money(view.income.prior)} />
              <Figure label="Year-on-year change" value={percent(view.income.change)} />
              <Figure label="Decay-adjusted income (the royalty multiple applies to this)" value={money(view.income.decayAdjusted)} />
            </dl>
            <table className="w-full text-left">
              <caption className="sr-only">Trailing income by source</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Source</th>
                  <th scope="col" className="text-right">Trailing income</th>
                </tr>
              </thead>
              <tbody>
                {view.income.bySource.map((row) => (
                  <tr key={row.source} className="border-t border-border">
                    <td>{row.label}</td>
                    <td className="text-right" data-numeric>{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full text-left">
              <caption className="text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">Decay by catalog age</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Age band</th>
                  <th scope="col" className="text-right">Works</th>
                  <th scope="col" className="text-right">Prior year</th>
                  <th scope="col" className="text-right">Trailing</th>
                  <th scope="col" className="text-right">Change</th>
                  <th scope="col" className="text-right">Decay-adjusted</th>
                </tr>
              </thead>
              <tbody>
                {view.income.bands.map((band) => (
                  <tr key={band.key} className="border-t border-border">
                    <td>{band.label}</td>
                    <td className="text-right" data-numeric>{band.works}</td>
                    <td className="text-right" data-numeric>{money(band.prior)}</td>
                    <td className="text-right" data-numeric>{money(band.trailing)}</td>
                    <td className="text-right" data-numeric>{band.change === null ? 'no prior year' : percent(band.change)}</td>
                    <td className="text-right" data-numeric>{money(band.decayAdjusted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.income.gaps.length ? (
              <p>
                <Badge variant="danger">Missing statements</Badge>{' '}
                {view.income.gaps.map((gap) => `${gap.payer}: ${gap.missing.join(', ')}`).join('; ')} — shown as absence, never estimated.
              </p>
            ) : (
              <p className="text-muted-foreground">Statement periods: {view.income.periods.join(', ')}. No payer skipped a period.</p>
            )}
            <Conventions items={view.income.conventions} />
          </>
        )}
      </Section>

      <Section title="Termination exposure">
        <form className="flex flex-wrap items-end gap-2" action={base}>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Hold period (years)
            <input name="hold" defaultValue={hold || String(view.termination.holdYears)} inputMode="numeric" className={`${inputClass} w-24`} />
          </label>
          <Button type="submit" size="sm" variant="outline">
            Recompute
          </Button>
          <span className="text-xs text-muted-foreground">Now using {HOLD_SOURCES[view.termination.holdSource]} of {view.termination.holdYears} years, to {view.termination.holdEnds ?? '—'}.</span>
        </form>
        <p>
          {view.termination.material ? <Badge variant="danger">Material</Badge> : <Badge variant="reviewed">Below {percent(view.termination.threshold)}</Badge>} Grants behind <strong>{percent(view.termination.share)}</strong> of trailing income ({money(view.termination.exposedIncome)} a year) become terminable inside the hold. Priced as its own line on the bridge: a price reduction on that share.
        </p>
        {view.termination.grants.length ? (
          <table className="w-full text-left">
            <caption className="sr-only">Grants terminable inside the hold</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Work</th>
                <th scope="col">Statute</th>
                <th scope="col">Window</th>
                <th scope="col" className="text-right">Share of the work</th>
                <th scope="col" className="text-right">Exposed income</th>
              </tr>
            </thead>
            <tbody>
              {view.termination.grants.map((grant) => (
                <tr key={`${grant.workId}:${grant.opens}`} className="border-t border-border">
                  <td>
                    {grant.title} <span className="text-xs text-muted-foreground">{grant.workId}</span>
                  </td>
                  <td>{grant.statute}</td>
                  <td>
                    {grant.opens} – {grant.closes}
                  </td>
                  <td className="text-right" data-numeric>{percent(grant.share)}</td>
                  <td className="text-right" data-numeric>{money(grant.exposedIncome)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {view.termination.grantCount > view.termination.grants.length ? <p className="text-xs text-muted-foreground">The {view.termination.grants.length} largest of {view.termination.grantCount} grants; the works register below shows every work&apos;s window.</p> : null}
        {view.termination.undated.length ? <p className="text-xs">No dates to compute a window from: {view.termination.undated.join(', ')}.</p> : null}
        <Conventions items={view.termination.conventions} />
      </Section>

      <Section title={`Works register (${view.register.works} works, ${view.register.grants} grants, ${view.register.statementLines} statement lines)`}>
        {view.register.withoutTitleEvidence ? (
          <p>
            <Badge variant="danger">Title gaps</Badge> {view.register.withoutTitleEvidence} earning work{view.register.withoutTitleEvidence === 1 ? '' : 's'} without both a registration and an assignment in the chain of title.
          </p>
        ) : null}
        {works.kind !== 'ok' ? (
          <ApiState result={works} />
        ) : works.data.items.length === 0 ? (
          <p className="text-muted-foreground">No works yet. Import the works register, splits, chain of title and statements on Sources (Industry data).</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Works by trailing income</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Work</th>
                  <th scope="col">Released</th>
                  <th scope="col" className="text-right">Trailing income</th>
                  <th scope="col" className="text-right">Share</th>
                  <th scope="col">Title evidence</th>
                  <th scope="col" className="text-right">Split sheet</th>
                  <th scope="col">Termination window</th>
                </tr>
              </thead>
              <tbody>
                {works.data.items.map((work) => (
                  <tr key={work.workId} className="border-t border-border align-top">
                    <td>
                      {work.title} <span className="text-xs text-muted-foreground">{work.workId} · {work.type}{work.pro ? ` · ${work.pro}` : ''}</span>
                    </td>
                    <td>{work.releaseYear ?? '—'}</td>
                    <td className="text-right" data-numeric>{money(work.trailing)}</td>
                    <td className="text-right" data-numeric>{percent(work.share)}</td>
                    <td>
                      {work.title_evidence.registration && work.title_evidence.assignment ? (
                        'Registered and assigned'
                      ) : (
                        <Badge variant="danger">{[work.title_evidence.registration ? null : 'no registration', work.title_evidence.assignment ? null : 'no assignment'].filter(Boolean).join(', ')}</Badge>
                      )}
                    </td>
                    <td className="text-right" data-numeric>
                      {work.splitSheetTotal === null ? '—' : work.splitSheetTotal === '100' ? '100%' : <Badge variant="danger">{work.splitSheetTotal}%</Badge>}
                    </td>
                    <td>{work.termination ? `${work.termination.statute} ${work.termination.opens} – ${work.termination.closes}${work.termination.insideHold ? ' (inside the hold)' : ''}` : work.usWork ? 'none' : 'not a US work'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager label="Works pages" base={base} links={pagerLinks({ ...works.data, itemCount: works.data.items.length }, worksAt, keepParams(search), 'works')} />
          </>
        )}
      </Section>

      <Section title="Read the rights documents">
        <p className="text-muted-foreground">AI reads a royalty statement, split sheet, publishing agreement, Copyright Office record or lien search and proposes the register entries it states, each with its exact quote. Nothing counts until you confirm it.</p>
        {view.documents.length === 0 ? <p className="text-muted-foreground">No documents yet. Upload the rights documents on Documents.</p> : null}
        <ul className="flex flex-col gap-2">
          {view.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-64">{document.fileName}</span>
              {document.rights ? <Badge variant="reviewed">rights document</Badge> : null}
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
            {source(item)}
            {view.canEdit ? (
              <form action={decideItem.bind(null, dealId, item.id)} className="flex flex-wrap items-center gap-2">
                {MUSIC_ITEM_REGISTRY[item.kind].work ? <input name="work" defaultValue={item.work ?? ''} aria-label="Work" className={`${inputClass} w-32`} /> : null}
                {MUSIC_ITEM_REGISTRY[item.kind].detail ? <input name="detail" defaultValue={item.detail ?? ''} aria-label={MUSIC_ITEM_REGISTRY[item.kind].detail ?? 'Detail'} className={`${inputClass} w-40`} /> : null}
                {MUSIC_ITEM_REGISTRY[item.kind].value !== 'NONE' ? <input name="value" defaultValue={item.value ?? ''} aria-label="Figure" className={`${inputClass} w-28`} /> : null}
                {MUSIC_ITEM_REGISTRY[item.kind].date ? <input name="date" defaultValue={item.date ?? ''} aria-label={MUSIC_ITEM_REGISTRY[item.kind].date ?? 'Date'} placeholder="YYYY-MM-DD" className={`${inputClass} w-32`} /> : null}
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

      <Section title={`Register entries from documents (${view.register.confirmedEntries} confirmed, ${view.register.corroboratedEntries} already in the import)`}>
        {entries.kind !== 'ok' ? (
          <ApiState result={entries} />
        ) : entries.data.items.length === 0 ? (
          <p className="text-muted-foreground">None yet. Read a rights document above, or enter an entry by hand below.</p>
        ) : (
          <>
            {entries.data.items.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 border-t border-border pt-2">
                <div>
                  <Badge variant={item.status === 'CONFIRMED' ? 'reviewed' : item.status === 'REJECTED' ? 'danger' : 'draft'}>{item.status === 'CONFIRMED' ? 'Confirmed' : item.status === 'REJECTED' ? 'Rejected' : 'To confirm'}</Badge> <strong>{item.kindLabel}</strong> — {reading(item)}{' '}
                  <span className="text-xs text-muted-foreground">({item.origin === 'AI' ? 'read by AI' : 'entered by a person'})</span>
                </div>
                {source(item)}
              </div>
            ))}
            <Pager label="Register entry pages" base={base} links={pagerLinks({ ...entries.data, itemCount: entries.data.items.length }, entriesAt, keepParams(search), 'entries')} />
          </>
        )}
        {view.canEdit ? (
          <details>
            <summary className="cursor-pointer font-medium">Enter an entry by hand</summary>
            <form action={addItem.bind(null, dealId)} className="mt-2 grid gap-2 sm:grid-cols-4">
              <select name="kind" aria-label="Kind" className={inputClass}>
                {MUSIC_ITEM_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {MUSIC_ITEM_REGISTRY[kind].label}
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
              <input name="work" placeholder="Work id or title (splits, grants, income)" aria-label="Work" className={inputClass} />
              <input name="detail" placeholder="Writer ref, grant type, income source or party" aria-label="Detail" className={inputClass} />
              <input name="value" placeholder="Figure as written (50, 412500)" aria-label="Figure" className={inputClass} />
              <input name="date" placeholder="Date (YYYY-MM-DD)" aria-label="Date" className={inputClass} />
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
        <Section title="Catalog checks">
          <p className="text-muted-foreground">Runs the pack&apos;s rules over the register, the statements, the confirmed entries and the documents: chain of title, splits, termination exposure, concentration, recoupment, leakage, encumbrances and missing statements. Drafts go to Findings; running again adds nothing already drafted.</p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run catalog checks</Button>
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
