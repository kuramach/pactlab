import { Badge, Button, Card, CardContent, CardHeader, CardTitle, type SectionAccent } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { percentOf } from '../fintech/format';
import { runChecks } from './actions';

interface Source {
  documentId: string;
  documentName: string | null;
  pageNumber: number;
  quote: string;
}
type ClaimStatus = 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED' | 'WITHIN_TOLERANCE';
type AgreementState = 'ENDS_BEFORE_CLOSING' | 'ENDS_IN_WINDOW' | 'RENEWS' | 'ENDS_LATER' | 'NO_END';
interface TelecomView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  conventions: string[];
  documentsRead: boolean;
  subscribers: {
    latestMonth: string | null;
    movementRows: number;
    trailing: { from: string; to: string; missing: string[]; opening: string; adds: string; disconnects: string; closing: string; netAdditions: string; revenue: string | null; churn: string | null; arpu: string | null } | null;
    years: { year: string; closing: string; churn: string | null; arpu: string | null; revenue: string | null }[];
  };
  claims: { key: string; label: string; status: ClaimStatus; stated: string; annual: boolean; measured: string | null; source: Source | null }[];
  rights: {
    windowMonths: number;
    materialShare: string;
    from: { date: string; basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; source: Source | null } | null;
    windowEnd: string | null;
    revenue: { from: string; to: string; total: string | null } | null;
    agreements: {
      agreementId: string;
      counterparty: string;
      kind: string;
      flow: string;
      annualValue: string | null;
      share: string | null;
      material: boolean;
      endsOn: string | null;
      registerEndsOn: string | null;
      endBasis: 'DOCUMENT' | 'REGISTER' | null;
      state: AgreementState;
      stateLabel: string;
      monthsAfter: number | null;
      renews: boolean | null;
      source: Source | null;
      renewalSource: Source | null;
    }[];
    agreementsTotal: number;
  };
  concentration: {
    threshold: string;
    streams: { stream: string; label: string; from: string; to: string; missing: string[]; total: string | null; counterparties: { counterparty: string; amount: string | null; share: string | null; rows: number }[]; counterpartiesTotal: number }[];
  };
  squeeze: { arpuFlat: boolean; years: { year: string; arpu: string | null; contentPerSubscriber: string | null; content: string | null; pnlRevenue: string | null; capex: string | null; capexIntensity: string | null }[] };
  trend: {
    version: string;
    partialYears: string[];
    conventions: string[];
    years: { year: string; basis: 'STATED' | 'ROLLED_UP'; revenue: string; revenueGrowth: string | null; grossMargin: string | null; operatingMargin: string | null; ratios: { key: string; label: string; amount: string; ratio: string | null }[]; lines: number; files: { uploadId: string; fileName: string }[] }[];
  };
}

const grouped = (value: string | null) => {
  if (value === null) return '—';
  const negative = value.startsWith('-');
  const [whole = '', fraction] = value.replace('-', '').split('.');
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction && /[1-9]/.test(fraction) ? `.${fraction.slice(0, 2)}` : ''}`;
};
const CLAIM_BADGE = { VERIFIED: 'reviewed', CONTRADICTED: 'danger', UNVERIFIED: 'draft', WITHIN_TOLERANCE: 'draft' } as const;
const CLAIM_WORD: Record<ClaimStatus, string> = { VERIFIED: 'verified', CONTRADICTED: 'contradicted', UNVERIFIED: 'unverified', WITHIN_TOLERANCE: 'close, not drafted' };
const STATE_BADGE = { ENDS_BEFORE_CLOSING: 'danger', ENDS_IN_WINDOW: 'danger', RENEWS: 'reviewed', ENDS_LATER: 'reviewed', NO_END: 'draft' } as const;
const OUTCOMES: Record<string, string> = {};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` };
  return OUTCOMES;
};

/**
 * Telecom and media (T-168): subscriber claims, rights windows and revenue concentration — subscribers,
 * churn and ARPU from the subscriber movements export against the deck's claims; the rights and carriage
 * register against the expected closing; advertising and affiliate revenue by counterparty; content cost
 * per subscriber and capex against ARPU; and the P&L across every imported year. Read-only; the checks run
 * into Findings. Documents, dates and arithmetic only; the buyer's own side.
 */
export default async function TelecomPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<TelecomView>(`/v1/deals/${dealId}/telecom`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : `${view.currency} ${grouped(value)}`);
  const cite = (source: Source) => (
    <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const claimFigure = (key: string, value: string | null) => (value === null ? '—' : key === 'SUBSCRIBERS' ? grouped(value) : key === 'CHURN' ? percentOf(value, 2) : money(value));
  const trailing = view.subscribers.trailing;
  const rights = view.rights;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Subscribers, churn and ARPU" accent="indigo">
        {!trailing ? (
          <p className="text-muted-foreground">No subscriber movements export yet. Import it on Sources (Industry data).</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label={`Subscribers, ${trailing.to}`} value={grouped(trailing.closing)} />
              <Figure label="Monthly churn (disconnects ÷ opening)" value={percentOf(trailing.churn, 2)} />
              <Figure label="ARPU a month" value={money(trailing.arpu)} />
              <Figure label="Net additions" value={grouped(trailing.netAdditions)} />
            </dl>
            <p className="text-muted-foreground">
              From {view.subscribers.movementRows} rows of the subscriber movements export, {trailing.from} to {trailing.to}: {grouped(trailing.adds)} gross additions and {grouped(trailing.disconnects)} disconnects on {grouped(trailing.opening)} opening subscribers, {money(trailing.revenue)} of service revenue.
              {trailing.missing.length ? ` Missing months: ${trailing.missing.join(', ')}.` : ''}
            </p>
          </>
        )}
        {view.subscribers.years.length === 0 ? (
          <p className="text-muted-foreground">No complete calendar year in the export yet; a year is read only when all twelve months are there.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Closing subscribers, monthly churn, ARPU and service revenue by calendar year, from the subscriber movements export</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Year</th>
                <th scope="col" className="text-right">Closing subscribers</th>
                <th scope="col" className="text-right">Monthly churn</th>
                <th scope="col" className="text-right">ARPU</th>
                <th scope="col" className="text-right">Service revenue</th>
              </tr>
            </thead>
            <tbody>
              {view.subscribers.years.map((year) => (
                <tr key={year.year} className="border-t border-border">
                  <td>{year.year}</td>
                  <td className="text-right" data-numeric>{grouped(year.closing)}</td>
                  <td className="text-right" data-numeric>{percentOf(year.churn, 2)}</td>
                  <td className="text-right" data-numeric>{money(year.arpu)}</td>
                  <td className="text-right" data-numeric>{money(year.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Subscriber claims" accent="violet">
        {view.claims.length === 0 ? (
          <p className="text-muted-foreground">{view.documentsRead ? 'No subscriber, churn or ARPU claim found in the documents.' : 'No documents read yet: the deck’s claims are checked once it is uploaded.'}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.claims.map((claim) => (
              <li key={claim.key} className="rounded-lg border border-border p-3">
                <p>
                  <Badge variant={CLAIM_BADGE[claim.status]}>{CLAIM_WORD[claim.status]}</Badge> {claim.label}: stated {claimFigure(claim.key, claim.stated)}
                  {claim.annual ? ' a year (compared as a twelfth a month)' : ''}, measured {claimFigure(claim.key, claim.measured)}. {claim.source ? <>“{claim.source.quote}” ({cite(claim.source)})</> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Rights and carriage register" accent="cobalt">
        <p className="text-muted-foreground">
          {rights.from
            ? `Measured from ${rights.from.basis === 'EXPECTED_CLOSING' ? 'the expected closing' : 'the latest month in the exports (no closing date is stated)'}, ${rights.from.date}, to ${rights.windowEnd}. `
            : 'No exports or closing date yet to measure from. '}
          An agreement is material at {percentOf(rights.materialShare, 0)} of trailing revenue or more{rights.revenue ? ` (${money(rights.revenue.total)}, ${rights.revenue.from} to ${rights.revenue.to})` : ''}. An agreement’s own end date governs over the register.
          {rights.from?.source ? <> “{rights.from.source.quote}” ({cite(rights.from.source)})</> : null}
        </p>
        {!view.documentsRead ? <p className="text-muted-foreground">No documents read yet: end dates are the register’s until the agreements are uploaded.</p> : null}
        {rights.agreements.length === 0 ? (
          <p className="text-muted-foreground">No rights and carriage register yet. Import it on Sources (Industry data).</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Content, affiliate, carriage and sports-rights agreements, their annual value and end date against the window after the closing</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Agreement</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className="text-right">Annual value</th>
                  <th scope="col" className="text-right">Of revenue</th>
                  <th scope="col">Ends</th>
                  <th scope="col">Against the closing</th>
                </tr>
              </thead>
              <tbody>
                {rights.agreements.map((agreement) => (
                  <tr key={agreement.agreementId} className="border-t border-border align-top">
                    <td>
                      {agreement.agreementId} · {agreement.counterparty} {agreement.material ? <Badge variant="draft">material</Badge> : null}
                    </td>
                    <td>
                      {agreement.kind}
                      <span className="block text-xs text-muted-foreground">{agreement.flow}</span>
                    </td>
                    <td className="text-right" data-numeric>{money(agreement.annualValue)}</td>
                    <td className="text-right" data-numeric>{percentOf(agreement.share, 1)}</td>
                    <td>
                      {agreement.endsOn ?? '—'}
                      {agreement.endBasis === 'DOCUMENT' && agreement.source ? (
                        <span className="block text-xs text-muted-foreground">
                          from {cite(agreement.source)}
                          {agreement.registerEndsOn && agreement.registerEndsOn !== agreement.endsOn ? `; the register says ${agreement.registerEndsOn}` : ''}
                        </span>
                      ) : agreement.endBasis === 'REGISTER' ? (
                        <span className="block text-xs text-muted-foreground">from the register</span>
                      ) : null}
                    </td>
                    <td>
                      <Badge variant={STATE_BADGE[agreement.state]}>{agreement.stateLabel}</Badge>
                      {agreement.monthsAfter !== null && agreement.state === 'ENDS_IN_WINDOW' ? <span className="block text-xs text-muted-foreground">{agreement.monthsAfter} months after</span> : null}
                      {agreement.renewalSource ? <span className="block text-xs text-muted-foreground">Renewal: {cite(agreement.renewalSource)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rights.agreementsTotal > rights.agreements.length ? <p className="text-muted-foreground">Showing the {rights.agreements.length} largest of {rights.agreementsTotal}.</p> : null}
          </>
        )}
      </Section>

      <Section title="Advertising and affiliate revenue by counterparty" accent="teal">
        {view.concentration.streams.length === 0 ? (
          <p className="text-muted-foreground">No advertising or affiliate revenue by counterparty yet. Import it on Sources (Industry data).</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {view.concentration.streams.map((stream) => (
              <div key={stream.stream} className="flex flex-col gap-2">
                <table className="w-full text-left">
                  <caption className="text-left text-xs text-muted-foreground">
                    {stream.label}, {stream.from} to {stream.to}: {money(stream.total)}
                    {stream.missing.length ? `. Missing months: ${stream.missing.join(', ')}` : ''}
                  </caption>
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th scope="col">Counterparty</th>
                      <th scope="col" className="text-right">Revenue</th>
                      <th scope="col" className="text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stream.counterparties.map((entry) => (
                      <tr key={entry.counterparty} className="border-t border-border">
                        <td>
                          {entry.counterparty} {entry.share && Number(entry.share) >= Number(view.concentration.threshold) ? <Badge variant="danger">dominant</Badge> : null}
                        </td>
                        <td className="text-right" data-numeric>{money(entry.amount)}</td>
                        <td className="text-right" data-numeric>{percentOf(entry.share, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stream.counterpartiesTotal > stream.counterparties.length ? <p className="text-muted-foreground">Showing the {stream.counterparties.length} largest of {stream.counterpartiesTotal}.</p> : null}
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground">One counterparty at {percentOf(view.concentration.threshold, 0)} of its stream or more is drafted as a finding.</p>
      </Section>

      <Section title="Content cost and capex against ARPU" accent="bronze">
        {view.squeeze.years.length === 0 ? (
          <p className="text-muted-foreground">Needs the P&L and the subscriber movements export for the same complete years; capital expenditure by year adds capex intensity.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">ARPU, content cost per subscriber and capex intensity by year</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Year</th>
                  <th scope="col" className="text-right">ARPU a month</th>
                  <th scope="col" className="text-right">Content per subscriber a month</th>
                  <th scope="col" className="text-right">Capex</th>
                  <th scope="col" className="text-right">Capex ÷ revenue</th>
                </tr>
              </thead>
              <tbody>
                {view.squeeze.years.map((year) => (
                  <tr key={year.year} className="border-t border-border">
                    <td>{year.year}</td>
                    <td className="text-right" data-numeric>{money(year.arpu)}</td>
                    <td className="text-right" data-numeric>{money(year.contentPerSubscriber)}</td>
                    <td className="text-right" data-numeric>{money(year.capex)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.capexIntensity, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground">{view.squeeze.arpuFlat ? 'ARPU is flat or falling across these years: rising costs per subscriber come out of the margin.' : 'ARPU rose across these years.'}</p>
          </>
        )}
      </Section>

      <Section title="P&L by year" accent="plum">
        {view.trend.years.length === 0 ? (
          <p className="text-muted-foreground">No P&L imported yet. Import one or more fiscal years on Sources (Profit and loss); every year imported is read.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Revenue, margins and key expense ratios by fiscal year, from the imported P&L</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Year</th>
                  <th scope="col" className="text-right">Revenue</th>
                  <th scope="col" className="text-right">Growth</th>
                  <th scope="col" className="text-right">Gross margin</th>
                  <th scope="col" className="text-right">Operating margin</th>
                  {view.trend.years[0]?.ratios.map((ratio) => (
                    <th key={ratio.key} scope="col" className="text-right">
                      {ratio.label} ÷ revenue
                    </th>
                  ))}
                  <th scope="col">From</th>
                </tr>
              </thead>
              <tbody>
                {view.trend.years.map((year) => (
                  <tr key={year.year} className="border-t border-border">
                    <td>{year.year}</td>
                    <td className="text-right" data-numeric>{money(year.revenue)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.revenueGrowth, 1)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.grossMargin, 1)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.operatingMargin, 1)}</td>
                    {year.ratios.map((ratio) => (
                      <td key={ratio.key} className="text-right" data-numeric>{percentOf(ratio.ratio, 1)}</td>
                    ))}
                    <td className="text-xs text-muted-foreground">
                      {year.lines} rows, {year.files.map((file) => file.fileName).join(', ') || 'no file'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.trend.years.length === 1 ? <p className="text-muted-foreground">One fiscal year imported: there is no trend yet. Import earlier years to read one.</p> : null}
            {view.trend.partialYears.length ? <p className="text-muted-foreground">Left out because not every month is imported: {view.trend.partialYears.join(', ')}.</p> : null}
          </>
        )}
        <Conventions items={[...view.conventions, ...view.trend.conventions]} />
      </Section>

      {view.canRunChecks ? (
        <Section title="Telecom and media checks" accent="moss">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over billing, subscribers by month, subscriber movements, the rights register, advertising and affiliate revenue, capex, the P&L and documents: reported against billed subscribers, the subscriber claims, the rights window, counterparty concentration, content cost and capex against ARPU and the multi-year trend. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run telecom and media checks</Button>
          </form>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: SectionAccent; children: ReactNode }) {
  return (
    <Card accent={accent}>
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
