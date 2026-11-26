import { QOE_ADJUSTMENT_CATEGORIES, QOE_CATEGORY_REGISTRY, QOE_COMPONENT_REGISTRY, QOE_VERIFICATION_LABELS, QOE_WORKING_CAPITAL_COMPONENTS, type QoeVerificationStatus } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addEntry, addPegTerm, decideAddBack, raisePnlConflicts } from './actions';

interface Cite {
  documentId: string;
  pageNumber: number;
  quote: string;
}
interface AddBack {
  entryKey: string;
  version: number;
  period: string;
  category: string;
  label: string;
  claimed: string;
  sellerRationale: string | null;
  status: QoeVerificationStatus;
  verified: string | null;
  verificationCitation: Cite | null;
  recurrence: 'RECURRING' | 'ONE_OFF';
  inclusion: 'INCLUDE' | 'EXCLUDE' | null;
  decisionReason: string | null;
  findingId: string | null;
  citation: Cite;
  counts: boolean;
  counted: string;
  treatment: string;
}
interface PnlFile {
  uploadId: string;
  fileName: string;
}
interface QoeView {
  disclaimer: string;
  engineVersion: string;
  currency: string;
  canEdit: boolean;
  canDecide: boolean;
  importedPnl: { readerVersion: string; ebitdaBasis: string; periods: number; files: PnlFile[] };
  conflicts: { period: string; imported: string; filed: string; difference: string; findingId: string | null }[];
  schedule: {
    period: string;
    pnl: { revenue: string; costOfRevenue: string; operatingExpenses: string; ebitda: string; rolledUpFrom: string[] | null; sources: { evidenceId: string }[] } | null;
    pnlFiles: PnlFile[];
    reportedEbitda: { amount: string; source: 'IMPORTED_PNL' | 'FILED_STATEMENT' | 'BOTH' } | null;
    conflict: { imported: string; filed: string; difference: string } | null;
    reported: { label: string; amount: string; citation: Cite } | null;
    adjustments: { entryKey: string; category: string; label: string; amount: string; rationale: string | null; findingId: string | null; citation: Cite }[];
    addBacks: AddBack[];
    totals: { adjustments: string; addBacksCounted: string; addBacksClaimed: string; addBacksExcluded: string };
    adjustedEbitda: string | null;
    sellerAdjustedEbitda: string | null;
    flags: string[];
  }[];
  register: AddBack[];
  workingCapital: {
    currency: string;
    periods: { periodEnd: string; currentAssets: string; currentLiabilities: string; netWorkingCapital: string }[];
    average: string | null;
    low: { periodEnd: string; amount: string } | null;
    high: { periodEnd: string; amount: string } | null;
    drivers: { component: string; label: string; range: string; firstToLast: string }[];
    peg: { amount: string; derivation: string } | null;
    pegUnavailable: string | null;
  };
  entries: { entryKey: string; citation: { documentId: string; documentName: string | null; valid: boolean } }[];
}

const OUTCOMES: Record<string, string> = {
  'ok-entry': 'Recorded, with its citation. Adjustments and add-backs are also drafted on Findings, where they are reviewed and priced.',
  'ok-included': 'Included by your decision. The reason is recorded with the add-back.',
  'ok-excluded': 'Excluded by your decision. The reason is recorded with the add-back.',
  'ok-peg': 'The peg is on your draft terms as a working-capital true-up. Review it on Proposed terms before proposing.',
  citation: 'That quote is not on the cited page. Copy it exactly from the document.',
  page: 'That document page is not available. Check the document and page number.',
  'people-data': 'People and compensation documents cannot be cited here.',
  currency: 'Enter figures in the pact’s base currency.',
  'no-peg': 'A peg needs at least three balance-sheet dates.',
  'peg-conflict': 'Draft terms first (Proposed terms), or this version already has a peg.',
  'decision-invalid': 'Give a reason for the decision.',
  'ok-conflicts': 'Each disagreement between the imported P&L and a filed statement is now a draft finding to review.',
};
const REPORTED_FROM = { IMPORTED_PNL: 'Imported EBITDA', FILED_STATEMENT: 'Filed EBITDA', BOTH: 'Imported EBITDA (the filed figure agrees)' } as const;
const STATUS_TONE = { VERIFIED: 'reviewed', PARTIALLY_VERIFIED: 'draft', UNVERIFIED: 'danger' } as const;
/** Thousands separators on a decimal string, without passing money through a float. */
const grouped = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '', fraction] = value.replace('-', '').split('.');
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction && /[1-9]/.test(fraction) ? `.${fraction}` : ''}`;
};
const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';

/**
 * Quality of earnings (T-135): the adjusted-EBITDA schedule, the seller's add-back register and
 * the working-capital analysis with its proposed peg. Platform-prepared analysis for the buyer
 * and their advisors; every figure cites its page and the arithmetic is deterministic.
 */
export default async function QoePage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const [result, documents] = await Promise.all([
    apiGet<QoeView>(`/v1/deals/${dealId}/qoe`),
    apiGet<{ items: { id: string; fileName: string }[] }>(`/v1/deals/${dealId}/documents?limit=100&sort=uploaded&dir=desc`),
  ]);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : `${view.currency} ${grouped(value)}`);
  const docs = documents.kind === 'ok' ? documents.data.items : [];
  const source = (citation: Cite) => {
    const entry = view.entries.find((candidate) => candidate.citation.documentId === citation.documentId);
    return (
      <span className="text-muted-foreground">
        <Link className="underline" href={`/deals/${dealId}/documents?documentId=${citation.documentId}&page=${citation.pageNumber}`}>
          {entry?.citation.documentName ?? 'Document'} p.{citation.pageNumber}
        </Link>
        : “{citation.quote}”{entry && !entry.citation.valid ? <Badge variant="danger">quote no longer on the page</Badge> : null}
      </span>
    );
  };
  const finding = (id: string | null) => (id ? <Link className="text-xs underline" href={`/deals/${dealId}/findings/${id}`}>finding</Link> : null);
  const imported = (period: QoeView['schedule'][number]) => (
    <span className="text-muted-foreground">
      <Badge variant="evidence">Imported P&L</Badge>{' '}
      {period.pnlFiles.map((file, index) => (
        <span key={file.uploadId}>
          {index ? ', ' : ''}
          <Link className="underline" href={`/deals/${dealId}/sources/upload/${file.uploadId}`}>
            {file.fileName}
          </Link>
        </span>
      ))}
      {` · ${period.pnl?.sources.length ?? 0} rows`}
      {period.pnl?.rolledUpFrom ? ` · ${period.pnl.rolledUpFrom[0]} to ${period.pnl.rolledUpFrom.at(-1)}` : ''}
    </span>
  );
  const unraised = view.conflicts.filter((conflict) => !conflict.findingId);

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Platform-prepared analysis.</strong> {view.disclaimer} Arithmetic: {view.engineVersion}.
      </p>

      <Section title="Adjusted-EBITDA schedule">
        {view.schedule.length === 0 ? <p className="text-muted-foreground">Nothing recorded yet. Import the P&L on <Link className="underline" href={`/deals/${dealId}/sources/upload`}>Sources</Link>, or record the reported EBITDA cited from the income statement.</p> : null}
        {view.importedPnl.periods > 0 ? <p className="text-muted-foreground">Revenue, costs and EBITDA come from the imported P&L where it covers a period ({view.importedPnl.readerVersion}). {view.importedPnl.ebitdaBasis}</p> : null}
        {view.conflicts.length > 0 ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            <p>
              <strong>The imported P&L and a filed statement disagree</strong> for {view.conflicts.map((conflict) => conflict.period).join(', ')}. Pactlab picks neither: adjusted EBITDA for those periods waits until one is corrected or withdrawn.
            </p>
            {unraised.length > 0 && view.canEdit ? (
              <form action={raisePnlConflicts.bind(null, dealId)}>
                <Button type="submit" size="sm" variant="outline">
                  Raise {unraised.length === 1 ? 'it' : 'them'} as findings to review
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
        {view.schedule.map((period) => (
          <div key={period.period} className="flex flex-col gap-2">
            <h3 className="font-medium">{period.period}</h3>
            <table className="w-full text-left">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Line</th>
                  <th className="py-1 text-right">Amount</th>
                  <th className="py-1 pl-4">Source</th>
                </tr>
              </thead>
              <tbody>
                {period.pnl ? (
                  <>
                    <Row cells={['Revenue', money(period.pnl.revenue), imported(period)]} />
                    <Row cells={['Cost of revenue', money(period.pnl.costOfRevenue), imported(period)]} />
                    <Row cells={['Operating expenses', money(period.pnl.operatingExpenses), imported(period)]} />
                    <Row cells={[<>EBITDA (imported) <Badge variant="calculation">calculated</Badge></>, money(period.pnl.ebitda), imported(period)]} />
                  </>
                ) : null}
                {period.reported ? (
                  <Row
                    cells={[
                      <>
                        Reported EBITDA (filed) {period.conflict ? <Badge variant="danger">disagrees by {money(period.conflict.difference)}</Badge> : null}{' '}
                        {period.conflict ? finding(view.conflicts.find((conflict) => conflict.period === period.period)?.findingId ?? null) : null}
                      </>,
                      money(period.reported.amount),
                      source(period.reported.citation),
                    ]}
                  />
                ) : null}
                {period.adjustments.map((line) => (
                  <Row key={line.entryKey} cells={[<>{QOE_CATEGORY_REGISTRY[line.category as keyof typeof QOE_CATEGORY_REGISTRY]?.label ?? line.category}: {line.label} {finding(line.findingId)}</>, money(line.amount), source(line.citation)]} />
                ))}
                {period.addBacks.map((line) => (
                  <Row key={line.entryKey} cells={[<>Add-back: {line.label} <Badge variant={STATUS_TONE[line.status]}>{QOE_VERIFICATION_LABELS[line.status]}</Badge> <span className="text-xs text-muted-foreground">{line.treatment}</span></>, money(line.counted), source(line.citation)]} />
                ))}
                <Row cells={[<strong key="a">Adjusted EBITDA (as analysed)</strong>, <strong key="b">{money(period.adjustedEbitda)}</strong>, period.reportedEbitda ? `${REPORTED_FROM[period.reportedEbitda.source]} + adjustments + counted add-backs` : 'Reported + adjustments + counted add-backs']} />
                <Row cells={['Seller-adjusted EBITDA (as claimed)', money(period.sellerAdjustedEbitda), 'Every add-back at the seller’s figure; shown apart, never merged']} />
              </tbody>
            </table>
            {period.flags.map((flag) => (
              <p key={flag} role="note" className="text-amber-900">
                {flag}
              </p>
            ))}
          </div>
        ))}
      </Section>

      <Section title="Add-back register">
        <p className="text-muted-foreground">What the seller claims (said) and what the evidence supports (observed) stay in separate columns. Unverified add-backs are excluded unless a reviewer includes one, with a reason.</p>
        {view.register.length === 0 ? <p className="text-muted-foreground">No add-backs claimed yet.</p> : null}
        {view.register.map((line) => (
          <div key={line.entryKey} className="flex flex-col gap-1 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{line.label}</span>
              <Badge variant={STATUS_TONE[line.status]}>{QOE_VERIFICATION_LABELS[line.status]}</Badge>
              <span className="text-muted-foreground">
                {line.period} · {line.recurrence === 'ONE_OFF' ? 'one-off' : 'recurring'} · claimed {money(line.claimed)}
                {line.verified ? ` · verified ${money(line.verified)}` : ''} · counted {line.counts ? money(line.counted) : 'none'} ({line.treatment})
              </span>
              {finding(line.findingId)}
            </div>
            {line.sellerRationale ? <p>Seller’s rationale: {line.sellerRationale}</p> : null}
            <p>Claim: {source(line.citation)}</p>
            {line.verificationCitation ? <p>Verified against: {source(line.verificationCitation)}</p> : null}
            {line.decisionReason ? <p>Reviewer {line.inclusion === 'INCLUDE' ? 'included' : 'excluded'} it: {line.decisionReason}</p> : null}
            {view.canDecide ? (
              <form action={decideAddBack.bind(null, dealId, line.entryKey, line.version)} className="mt-1 flex flex-wrap items-center gap-2">
                <select name="decision" aria-label={`Decision on ${line.label}`} className={inputClass} defaultValue={line.counts ? 'EXCLUDE' : 'INCLUDE'}>
                  <option value="INCLUDE">Include</option>
                  <option value="EXCLUDE">Exclude</option>
                </select>
                <input name="reason" required minLength={3} placeholder="Why (recorded)" aria-label={`Reason for the decision on ${line.label}`} className={`${inputClass} min-w-64 flex-1`} />
                <Button type="submit" size="sm" variant="outline">
                  Record decision
                </Button>
              </form>
            ) : null}
          </div>
        ))}
      </Section>

      <Section title="Working capital">
        {view.workingCapital.periods.length === 0 ? (
          <p className="text-muted-foreground">No balance-sheet lines yet. Record receivables, inventory, payables and the like for each month-end; cash and debt are never components.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Balance-sheet date</th>
                  <th className="py-1 text-right">Current assets</th>
                  <th className="py-1 text-right">Current liabilities</th>
                  <th className="py-1 text-right">Net working capital</th>
                </tr>
              </thead>
              <tbody>
                {view.workingCapital.periods.map((period) => (
                  <Row key={period.periodEnd} cells={[period.periodEnd, money(period.currentAssets), money(period.currentLiabilities), money(period.netWorkingCapital)]} />
                ))}
              </tbody>
            </table>
            <dl className="grid gap-1 sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted-foreground">Average</dt>
              <dd>{money(view.workingCapital.average)}</dd>
              <dt className="text-muted-foreground">Seasonal range</dt>
              <dd>{view.workingCapital.low && view.workingCapital.high ? `${money(view.workingCapital.low.amount)} (${view.workingCapital.low.periodEnd}) to ${money(view.workingCapital.high.amount)} (${view.workingCapital.high.periodEnd})` : '—'}</dd>
              <dt className="text-muted-foreground">What moves it</dt>
              <dd>{view.workingCapital.drivers.slice(0, 3).map((driver) => `${driver.label} swings ${money(driver.range)}`).join('; ') || '—'}</dd>
              <dt className="text-muted-foreground">Proposed peg</dt>
              <dd>{view.workingCapital.peg ? <strong>{money(view.workingCapital.peg.amount)}</strong> : view.workingCapital.pegUnavailable}</dd>
            </dl>
            {view.workingCapital.peg ? <p className="text-muted-foreground">{view.workingCapital.peg.derivation}</p> : null}
            {view.workingCapital.peg && view.canEdit ? (
              <form action={addPegTerm.bind(null, dealId)}>
                <Button type="submit" size="sm">
                  Add the peg to draft terms
                </Button>
                <span className="ml-2 text-xs text-muted-foreground">A working-capital true-up the seller answers like any term; it never moves the price bridge.</span>
              </form>
            ) : null}
          </>
        )}
      </Section>

      {view.canEdit ? (
        <Section title="Record a cited figure">
          <p className="text-muted-foreground">Every figure cites the exact passage it comes from. Amounts are in {view.currency}; an adjustment that lowers EBITDA is negative.</p>
          {(
            [
              ['REPORTED_EBITDA', 'Reported EBITDA', null],
              ['ADJUSTMENT', 'Normalization adjustment', QOE_ADJUSTMENT_CATEGORIES.map((category) => [category, QOE_CATEGORY_REGISTRY[category].label] as const)],
              ['ADD_BACK', 'Seller-claimed add-back', QOE_ADJUSTMENT_CATEGORIES.map((category) => [category, QOE_CATEGORY_REGISTRY[category].label] as const)],
              ['WORKING_CAPITAL', 'Working-capital line', QOE_WORKING_CAPITAL_COMPONENTS.map((component) => [component, QOE_COMPONENT_REGISTRY[component].label] as const)],
            ] as const
          ).map(([kind, label, categories]) => (
            <details key={kind} className="rounded-md border border-border p-3">
              <summary className="cursor-pointer font-medium">{label}</summary>
              <form action={addEntry.bind(null, dealId, kind)} className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="currency" value={view.currency} />
                {kind === 'WORKING_CAPITAL' ? <input name="periodEnd" required placeholder="Balance-sheet date (YYYY-MM-DD)" aria-label="Balance-sheet date" className={inputClass} /> : <input name="period" required placeholder="Period, e.g. FY2025" aria-label="Period" className={inputClass} />}
                {categories ? (
                  <select name="category" aria-label={`${label} category`} className={inputClass}>
                    {categories.map(([value, name]) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <input name="label" required placeholder="Label" aria-label={`${label} label`} className={inputClass} />
                <input name="amount" required placeholder={kind === 'ADD_BACK' ? 'Amount the seller claims' : 'Amount'} aria-label={`${label} amount`} className={inputClass} />
                {kind === 'ADJUSTMENT' || kind === 'ADD_BACK' ? <input name="rationale" required placeholder={kind === 'ADD_BACK' ? 'Seller’s stated rationale' : 'Why this normalization'} aria-label={`${label} rationale`} className={`${inputClass} sm:col-span-2`} /> : null}
                {kind === 'ADD_BACK' ? (
                  <>
                    <select name="recurrence" aria-label="Recurring or one-off" className={inputClass}>
                      <option value="ONE_OFF">One-off</option>
                      <option value="RECURRING">Recurring</option>
                    </select>
                    <select name="verificationStatus" aria-label="Verification status" className={inputClass} defaultValue="UNVERIFIED">
                      <option value="UNVERIFIED">Unverified</option>
                      <option value="PARTIALLY_VERIFIED">Partially verified</option>
                      <option value="VERIFIED">Verified</option>
                    </select>
                    <input name="verifiedAmount" placeholder="Verified amount (partially verified only)" aria-label="Verified amount" className={inputClass} />
                    <Citation docs={docs} prefix="v-" label="Verification evidence (verified or partially verified only)" required={false} />
                  </>
                ) : null}
                <Citation docs={docs} prefix="" label={kind === 'ADD_BACK' ? 'Where the seller claims it' : 'Where the figure is stated'} required />
                <div>
                  <Button type="submit" size="sm" variant="outline">
                    Record {label.toLowerCase()}
                  </Button>
                </div>
              </form>
            </details>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Citation({ docs, prefix, label, required }: { docs: { id: string; fileName: string }[]; prefix: string; label: string; required: boolean }) {
  return (
    <fieldset className="grid gap-2 sm:col-span-2 sm:grid-cols-[1fr_6rem_2fr]">
      <legend className="mb-1 text-xs text-muted-foreground">{label}</legend>
      <select name={`${prefix}documentId`} required={required} aria-label={`${label}: document`} className={inputClass}>
        {required ? null : <option value="">—</option>}
        {docs.map((document) => (
          <option key={document.id} value={document.id}>
            {document.fileName}
          </option>
        ))}
      </select>
      <input name={`${prefix}pageNumber`} defaultValue="1" aria-label={`${label}: page`} className={inputClass} />
      <input name={`${prefix}quote`} required={required} placeholder="Passage, copied exactly" aria-label={`${label}: passage`} className={inputClass} />
    </fieldset>
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

function Row({ cells }: { cells: readonly ReactNode[] }) {
  return (
    <tr className="border-t border-border align-top">
      {cells.map((cell, index) => (
        <td key={index} className={`py-1 ${index === 1 ? 'text-right tabular-nums' : index > 1 ? 'pl-4' : ''}`}>
          {cell}
        </td>
      ))}
    </tr>
  );
}
