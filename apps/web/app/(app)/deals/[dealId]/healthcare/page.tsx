import { Badge, Button, Card, CardContent, CardHeader, CardTitle, type SectionAccent } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { percentOf } from '../fintech/format';
import { runChecks } from './actions';
import { formatAmount } from '@pactlab/domain';

interface Source {
  documentId: string;
  documentName: string | null;
  pageNumber: number;
  quote: string;
}
interface Period {
  label: string;
  from: string;
  to: string;
  missing: string[];
  claims: string;
  denied: string;
  billed: string | null;
  collected: string | null;
  denialRate: string | null;
  collectionRate: string | null;
  daysInAr: string | null;
  rows: number;
  byClass: { payerClass: string; label: string; collected: string | null; share: string | null; claimShare: string | null; yieldPerClaim: string | null }[];
}
type CredentialState = 'EXPIRED' | 'NEAR_EXPIRY' | 'PENDING' | 'ACTIVE' | 'NO_EXPIRY';
interface HealthcareView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  analysisDate: string | null;
  collections: { remittanceRows: number; payers: number; trailing: Period | null; years: Period[]; partialYears: string[] };
  claims: { title: string; status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED'; statement: string; rationale: string; source: Source | null }[];
  clinicians: { from: string; to: string; missing: string[]; total: string | null; threshold: string; count: number; shown: number; items: { providerRef: string; collected: string | null; share: string | null; covenant: Source | null }[] } | null;
  credentials: {
    nearExpiryDays: number;
    total: number;
    active: number;
    exceptions: { evidenceId: string; providerRef: string; credentialRef: string; kindLabel: string; jurisdiction: string; issuer: string; registerStatus: string; registerExpiresOn: string | null; expiresOn: string | null; state: CredentialState; registerDiffers: boolean; collectedAfter: { months: number; collected: string | null } | null; source: Source | null }[];
    unlicensed: string[];
  };
  contracts: { windowDays: number; registerRows: number; payers: { payer: string; payerClass: string; collected: string | null; share: string | null; contractId: string | null; expiresOn: string | null; autoRenews: boolean | null; state: 'EXPIRED' | 'EXPIRING' | 'CURRENT' | 'RENEWS' | 'NO_EXPIRY' | 'MISSING'; daysToExpiry: number | null }[] };
  compliance: { codingAuditStaleDays: number; kinds: { kind: string; label: string; present: boolean; documents: { documentId: string; documentName: string | null; date: string | null; recognisedBy: 'HEADING' | 'CATEGORY'; source: Source | null }[] }[] };
  reconciliation: { tolerance: string; years: { year: string; collected: string | null; pnlPatientRevenue: string | null; difference: string; relative: string | null; accounts: string[]; reconciles: boolean | null }[] };
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
const CLAIM_BADGE = { VERIFIED: 'reviewed', CONTRADICTED: 'danger', UNVERIFIED: 'draft' } as const;
const CREDENTIAL_STATE = { EXPIRED: 'Expired', NEAR_EXPIRY: 'Expires soon', PENDING: 'Pending', ACTIVE: 'Active', NO_EXPIRY: 'No expiry stated' } as const;
const CONTRACT_STATE = { EXPIRED: 'Expired', EXPIRING: 'Ends within the window', CURRENT: 'Current', RENEWS: 'Renews automatically', NO_EXPIRY: 'No end date', MISSING: 'No contract on the register' } as const;
const OUTCOMES: Record<string, string> = {};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` };
  return OUTCOMES;
};

/**
 * Healthcare services (T-160): multi-site provider diligence — collections, denials, days in AR and the
 * payer mix recomputed from the remittance export, the deck's claims against them, every clinician's
 * licences, clinician concentration against the non-compete schedule, the payer contract register,
 * compliance evidence as present or absent, and the P&L across every imported year. Read-only; the
 * checks run into Findings. Documents, dates and arithmetic only; the buyer's own side.
 */
export default async function HealthcarePage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<HealthcareView>(`/v1/deals/${dealId}/healthcare`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : formatAmount(value, view.currency, { fraction: 'trim' }));
  const cite = (source: Source) => (
    <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const trailing = view.collections.trailing;
  const latestYear = view.collections.years.at(-1);

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Collections, denials and days in receivable" accent="indigo">
        {!trailing ? (
          <p className="text-muted-foreground">No remittance export yet. Import the remittances by payer on Sources (Industry data).</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label={`Collected, ${trailing.from} to ${trailing.to}`} value={money(trailing.collected)} />
              <Figure label="Gross collection rate" value={percentOf(trailing.collectionRate, 1)} />
              <Figure label="Denial rate" value={percentOf(trailing.denialRate, 1)} />
              <Figure label="Days in receivable" value={trailing.daysInAr ?? '—'} />
            </dl>
            <p className="text-muted-foreground">
              From {view.collections.remittanceRows} payer-months across {view.collections.payers} payers.{trailing.missing.length ? ` Missing months: ${trailing.missing.join(', ')}.` : ''}
            </p>
            {view.collections.years.length ? (
              <table className="w-full text-left">
                <caption className="sr-only">Collections, denials and days in receivable by calendar year, from the remittance export</caption>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col">Year</th>
                    <th scope="col" className="text-right">Charges billed</th>
                    <th scope="col" className="text-right">Collected</th>
                    <th scope="col" className="text-right">Claims</th>
                    <th scope="col" className="text-right">Denied</th>
                    <th scope="col" className="text-right">Denial rate</th>
                    <th scope="col" className="text-right">Days in receivable at year end</th>
                  </tr>
                </thead>
                <tbody>
                  {view.collections.years.map((year) => (
                    <tr key={year.label} className="border-t border-border">
                      <td>{year.label}</td>
                      <td className="text-right" data-numeric>{money(year.billed)}</td>
                      <td className="text-right" data-numeric>{money(year.collected)}</td>
                      <td className="text-right" data-numeric>{grouped(year.claims)}</td>
                      <td className="text-right" data-numeric>{grouped(year.denied)}</td>
                      <td className="text-right" data-numeric>{percentOf(year.denialRate, 1)}</td>
                      <td className="text-right" data-numeric>{year.daysInAr ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {view.collections.partialYears.length ? <p className="text-muted-foreground">Left out of the yearly view because not every month is imported: {view.collections.partialYears.join(', ')}.</p> : null}
          </>
        )}
      </Section>

      <Section title="Payer mix" accent="cobalt">
        {view.collections.years.length === 0 ? (
          <p className="text-muted-foreground">No complete calendar year of remittances yet; the payer mix is read by year.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Share of collections and of claims by payer class and year, with collected per claim</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Payer class</th>
                {view.collections.years.map((year) => (
                  <th key={year.label} scope="col" className="text-right">
                    {year.label} share of claims
                  </th>
                ))}
                <th scope="col" className="text-right">{latestYear?.label} share of collections</th>
                <th scope="col" className="text-right">{latestYear?.label} collected per claim</th>
              </tr>
            </thead>
            <tbody>
              {(latestYear?.byClass ?? []).map((entry) => (
                <tr key={entry.payerClass} className="border-t border-border">
                  <td>{entry.label}</td>
                  {view.collections.years.map((year) => (
                    <td key={year.label} className="text-right" data-numeric>
                      {percentOf(year.byClass.find((other) => other.payerClass === entry.payerClass)?.claimShare ?? null, 1)}
                    </td>
                  ))}
                  <td className="text-right" data-numeric>{percentOf(entry.share, 1)}</td>
                  <td className="text-right" data-numeric>{money(entry.yieldPerClaim)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Claims register" accent="teal">
        {view.claims.length === 0 ? (
          <p className="text-muted-foreground">No denial-rate, payer-share or days-in-receivable claim found in the documents.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.claims.map((claim) => (
              <li key={claim.title} className="rounded-lg border border-border p-3">
                <p>
                  <Badge variant={CLAIM_BADGE[claim.status]}>{claim.status.toLowerCase()}</Badge> “{claim.statement}” {claim.source ? <>({cite(claim.source)})</> : null}
                </p>
                <p className="text-muted-foreground">{claim.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Credentialing" accent="violet">
        <p className="text-muted-foreground">
          Status at {view.analysisDate ?? 'no analysis date (no remittance export)'}; a credential expiring within {view.credentials.nearExpiryDays} days is flagged. Where a verification document states the expiry, it governs. {view.credentials.active} of {view.credentials.total} credentials are active.
        </p>
        {view.credentials.total === 0 ? <p className="text-muted-foreground">No credentialing register yet. Import it on Sources (Industry data).</p> : null}
        {view.credentials.exceptions.length ? (
          <table className="w-full text-left">
            <caption className="sr-only">Credentials that are expired, expiring or pending</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Clinician</th>
                <th scope="col">Credential</th>
                <th scope="col">Register</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Collected after expiry</th>
              </tr>
            </thead>
            <tbody>
              {view.credentials.exceptions.map((entry) => (
                <tr key={entry.evidenceId} className="border-t border-border align-top">
                  <td>{entry.providerRef}</td>
                  <td>
                    {entry.jurisdiction} {entry.kindLabel.toLowerCase()} <span className="block text-xs text-muted-foreground">{entry.issuer}</span>
                  </td>
                  <td>
                    {entry.registerStatus}
                    {entry.registerExpiresOn ? `, to ${entry.registerExpiresOn}` : ''}
                  </td>
                  <td>
                    {entry.expiresOn ?? '—'} {entry.source ? <span className="text-xs">({cite(entry.source)})</span> : null}
                    {entry.registerDiffers ? <span className="block text-xs text-muted-foreground">The register gives another date.</span> : null}
                  </td>
                  <td>{entry.state === 'EXPIRED' ? <Badge variant="danger">{CREDENTIAL_STATE[entry.state]}</Badge> : <Badge variant="draft">{CREDENTIAL_STATE[entry.state]}</Badge>}</td>
                  <td className="text-right" data-numeric>
                    {entry.collectedAfter ? `${money(entry.collectedAfter.collected)} over ${entry.collectedAfter.months} month${entry.collectedAfter.months === 1 ? '' : 's'}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : view.credentials.total ? (
          <p className="text-muted-foreground">Every credential on the register is active at the analysis date.</p>
        ) : null}
        {view.credentials.unlicensed.length ? <p>No licence on file for {view.credentials.unlicensed.join(', ')}: request the primary-source verification.</p> : null}
      </Section>

      <Section title="Clinician concentration" accent="plum">
        {!view.clinicians ? (
          <p className="text-muted-foreground">No collections by clinician yet. Import them on Sources (Industry data).</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              Share of {money(view.clinicians.total)} collected from {view.clinicians.from} to {view.clinicians.to}, by pseudonymous reference. A clinician at {percentOf(view.clinicians.threshold, 0)} or more with no non-compete or retention agreement in the evidence is a finding. A retention risk, never a ranking.
              {view.clinicians.count > view.clinicians.shown ? ` The largest ${view.clinicians.shown} of ${view.clinicians.count} are shown.` : ''}
            </p>
            <table className="w-full text-left">
              <caption className="sr-only">Collections by clinician, largest first</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Clinician</th>
                  <th scope="col" className="text-right">Collected</th>
                  <th scope="col" className="text-right">Share</th>
                  <th scope="col">Non-compete or retention</th>
                </tr>
              </thead>
              <tbody>
                {view.clinicians.items.map((item) => (
                  <tr key={item.providerRef} className="border-t border-border">
                    <td>{item.providerRef}</td>
                    <td className="text-right" data-numeric>{money(item.collected)}</td>
                    <td className="text-right" data-numeric>{percentOf(item.share, 1)}</td>
                    <td>{item.covenant ? cite(item.covenant) : <span className="text-muted-foreground">None in the evidence</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title="Payer contracts" accent="bronze">
        {view.contracts.registerRows === 0 ? (
          <p className="text-muted-foreground">No payer contract register yet. Import it on Sources (Industry data); until then no payer is assumed to be without a contract.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Payers that remitted in the trailing twelve months against the payer contract register</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Payer</th>
                <th scope="col" className="text-right">Share of collections</th>
                <th scope="col">Contract</th>
                <th scope="col">Ends</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.contracts.payers.map((payer) => (
                <tr key={payer.payer} className="border-t border-border">
                  <td>{payer.payer}</td>
                  <td className="text-right" data-numeric>{percentOf(payer.share, 1)}</td>
                  <td>{payer.contractId ?? '—'}</td>
                  <td>{payer.expiresOn ?? '—'}</td>
                  <td>{payer.state === 'EXPIRED' || payer.state === 'MISSING' ? <Badge variant="danger">{CONTRACT_STATE[payer.state]}</Badge> : payer.state === 'EXPIRING' ? <Badge variant="draft">{CONTRACT_STATE[payer.state]}</Badge> : CONTRACT_STATE[payer.state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground">A contract ending within {view.contracts.windowDays} days of the analysis date without automatic renewal is inside the window. Self-pay is left out.</p>
      </Section>

      <Section title="Compliance evidence" accent="slate">
        <ul className="flex flex-col gap-2">
          {view.compliance.kinds.map((entry) => (
            <li key={entry.kind}>
              {entry.present ? <Badge variant="evidence">On file</Badge> : <Badge variant="danger">Not in the evidence</Badge>} <strong>{entry.label}</strong>
              {entry.documents.length ? (
                <ul className="ml-5 list-disc text-muted-foreground">
                  {entry.documents.map((document) => (
                    <li key={document.documentId}>
                      {document.source ? cite(document.source) : (document.documentName ?? 'Document')}
                      {document.date ? `, dated ${document.date}` : ''}
                      {document.recognisedBy === 'CATEGORY' ? ' (filed under this category)' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground"> — absent; request it from the seller.</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">A coding or billing audit more than {view.compliance.codingAuditStaleDays} days old is drafted for review. Presence and dates only: never whether coding, billing or privacy practice is compliant.</p>
      </Section>

      <Section title="P&L by year" accent="moss">
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
                      <td key={ratio.key} className="text-right" data-numeric>{percentOf(ratio.ratio, 2)}</td>
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
        {view.reconciliation.years.length ? (
          <ul className="flex flex-col gap-1">
            {view.reconciliation.years.map((year) => (
              <li key={year.year}>
                {year.reconciles ? <Badge variant="reviewed">Reconciles</Badge> : <Badge variant="danger">Does not reconcile</Badge>} {year.year}: P&L patient revenue {money(year.pnlPatientRevenue)} ({year.accounts.join(', ')}) against {money(year.collected)} collected in the remittance export.
              </li>
            ))}
          </ul>
        ) : null}
        <Conventions items={view.trend.conventions} />
      </Section>

      {view.canRunChecks ? (
        <Section title="Healthcare checks" accent="indigo">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over the remittances, collections by clinician, the credentialing and payer contract registers, the P&L and documents: the claims register, denials and days in receivable, the payer mix, credentials, clinician concentration, payer contracts, compliance evidence and the multi-year trend. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run healthcare checks</Button>
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
