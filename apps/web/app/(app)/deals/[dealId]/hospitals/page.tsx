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
type ClaimStatus = 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED';
interface Claim {
  title: string;
  status: ClaimStatus;
  statement: string;
  rationale: string;
  source: Source | null;
}
type ContractState = 'EXPIRED_AT_CLOSE' | 'EXPIRES_WITHIN_YEAR' | 'RENEWS' | 'CURRENT' | 'NO_EXPIRY' | 'NO_AGREEMENT' | 'NOT_CONTRACTED';
interface HospitalView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  analysisDate: string | null;
  census: { from: string; to: string; missing: string[]; admissions: string; patientDays: string; averageDailyCensus: string | null; averageLengthOfStay: string | null; occupancy: string | null } | null;
  costReport: {
    tolerance: { verified: string; contradicted: string };
    pnlTolerance: string;
    reports: { documentId: string; documentName: string | null; heading: Source | null; fiscalYear: string | null; beds: { value: string; source: Source | null } | null; patientDays: { value: string; source: Source | null } | null; figures: { key: string; label: string; value: string; currency: string | null; source: Source | null }[] }[];
    claims: Claim[];
    reconciliation: { fiscalYear: string; costReportCosts: string | null; pnlCosts: string | null; difference: string; share: string; agrees: boolean }[];
  };
  payerContracts: {
    materialShare: string;
    windowMonths: number;
    terms: Record<'RATE_BASIS' | 'EXPIRY' | 'RENEGOTIATION', string>;
    measuredFrom: { date: string; basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; source: Source | null } | null;
    count: number;
    payers: {
      payer: string;
      netRevenue: string | null;
      share: string | null;
      contracted: boolean;
      material: boolean;
      largestContracted: boolean;
      state: ContractState;
      monthsAfterClose: number | null;
      agreement: { documentId: string; documentName: string | null; expiresOn: string | null; autoRenews: boolean; expiry: Source | null; rateBasis: Source | null; renegotiation: Source | null } | null;
    }[];
  };
  medicalStaff: {
    clusterSize: number;
    dueDays: number;
    count: number;
    departments: { department: string; staff: number; privilegesLapsed: number; licencesExpired: number }[];
    clusters: { department: string; date: string; state: 'LAPSED' | 'DUE'; staff: string[]; departmentSize: number }[];
    exceptionCount: number;
    exceptions: { staffRef: string; department: string; licenceExpiresOn: string | null; licenceExpired: boolean; licenceVerified: Source | null; privilegesExpireOn: string | null; privilegeStatus: string; privilegesLapsed: boolean }[];
  };
  plant: {
    fallFactor: string;
    years: { year: string; amount: string | null; revenue: string | null; ratio: string | null; files: { uploadId: string; fileName: string }[] }[];
    claim: Source | null;
    assessments: { documentId: string; documentName: string | null; heading: Source | null; statements: (Source | null)[]; deferredMaintenance: { amount: string | null; currency: string; source: Source | null } | null }[];
  };
  quality: { reports: { documentId: string; documentName: string | null; heading: Source | null; stars: number | null; source: Source | null }[]; claims: Claim[] };
  trend: {
    version: string;
    partialYears: string[];
    conventions: string[];
    years: { year: string; basis: string; revenue: string; revenueGrowth: string | null; grossMargin: string | null; operatingMargin: string | null; ratios: { key: string; label: string; amount: string; ratio: string | null }[]; lines: number; files: { uploadId: string; fileName: string }[] }[];
  };
}

const grouped = (value: string | null) => {
  if (value === null) return '—';
  const negative = value.startsWith('-');
  const [whole = ''] = value.replace('-', '').split('.');
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};
const CLAIM_BADGE = { VERIFIED: 'reviewed', CONTRADICTED: 'danger', UNVERIFIED: 'draft' } as const;
const CLAIM_LABEL = { VERIFIED: 'Verified', CONTRADICTED: 'Contradicted', UNVERIFIED: 'Not verified' } as const;
const CONTRACT_LABEL: Record<ContractState, string> = {
  EXPIRED_AT_CLOSE: 'Ends before closing',
  EXPIRES_WITHIN_YEAR: 'Ends within a year of closing',
  RENEWS: 'Renews automatically',
  CURRENT: 'Current',
  NO_EXPIRY: 'No end date stated',
  NO_AGREEMENT: 'No agreement on file',
  NOT_CONTRACTED: 'Programme or self-pay',
};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  return checks ? { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` } : {};
};

/**
 * Hospitals (T-162): what only hospitals carry — the filed cost report against the deck and the P&L, the
 * payer contract register read from the agreements, the medical staff by department, capital spend
 * across the imported P&L years beside the property condition assessment, and quality claims mapped to
 * the reporting supplied. Read-only; the checks run into Findings. Documents, dates and arithmetic only.
 */
export default async function HospitalsPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<HospitalView>(`/v1/deals/${dealId}/hospitals`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : `${view.currency} ${grouped(value)}`);
  const cite = (source: Source) => (
    <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const quoted = (source: Source | null) => (source ? <>“{source.quote}” {cite(source)}</> : <span className="text-muted-foreground">No sentence states it.</span>);
  const { census, costReport, payerContracts, medicalStaff, plant, quality, trend } = view;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Cost report" accent="cobalt">
        {costReport.reports.length === 0 ? (
          <p className="text-muted-foreground">No cost report in the documents yet. Upload the filed cost report (or its summary); the intake checklist asks the seller for it. Until then the deck&apos;s figures stay unverified.</p>
        ) : (
          costReport.reports.map((report) => (
            <div key={report.documentId} className="flex flex-col gap-2">
              <p>
                <strong>{report.documentName ?? 'Cost report'}</strong>
                {report.fiscalYear ? `, fiscal year ${report.fiscalYear}` : ', fiscal year not stated'} {report.heading ? cite(report.heading) : null}
              </p>
              <dl className="grid gap-3 sm:grid-cols-3">
                <Figure label="Licensed beds" value={report.beds?.value ?? 'Not stated'} />
                <Figure label="Inpatient days" value={report.patientDays ? grouped(report.patientDays.value) : 'Not stated'} />
                {report.figures.map((figure) => (
                  <Figure key={figure.key} label={figure.label} value={figure.key === 'TOTAL_COSTS' ? `${figure.currency ?? view.currency} ${grouped(figure.value)}` : `${figure.value}%`} />
                ))}
              </dl>
            </div>
          ))
        )}
        <ClaimList claims={costReport.claims} cite={cite} empty="The deck and other seller documents state no occupancy or payer share of inpatient days to check." />
        {costReport.reconciliation.map((entry) => (
          <p key={entry.fiscalYear}>
            {entry.agrees ? <Badge variant="reviewed">Reconciles</Badge> : <Badge variant="danger">Does not reconcile</Badge>} Fiscal year {entry.fiscalYear}: the cost report&apos;s total costs {money(entry.costReportCosts)} against {money(entry.pnlCosts)} of cost of revenue and operating expenses in the imported P&L ({percentOf(entry.share, 1)} apart).
          </p>
        ))}
        {census ? (
          <p className="text-xs text-muted-foreground">
            Census, {census.from} to {census.to}: {grouped(census.admissions)} admissions, {grouped(census.patientDays)} patient days, an average daily census of {census.averageDailyCensus ?? '—'} and an average stay of {census.averageLengthOfStay ?? '—'} days
            {census.occupancy ? `, ${percentOf(census.occupancy, 1)} of the cost report’s licensed beds` : ''}.{census.missing.length ? ` Missing months: ${census.missing.join(', ')}.` : ''}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          A deck figure within {costReport.tolerance.verified} point of the cost report is verified; more than {costReport.tolerance.contradicted} points off is contradicted. The cost report&apos;s costs and the P&L&apos;s more than {percentOf(costReport.pnlTolerance, 0)} apart are drafted on Findings.
        </p>
      </Section>

      <Section title="Payer contracts" accent="teal">
        {payerContracts.payers.length === 0 ? (
          <p className="text-muted-foreground">No payer-mix export yet. Import the payer mix on Sources (Industry data) to read each payer&apos;s share and match its agreement.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Payers by net revenue over the trailing twelve months, with each agreement&apos;s rate basis, end date and renewal</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Payer</th>
                  <th scope="col" className="text-right">Share</th>
                  <th scope="col">{payerContracts.terms.EXPIRY}</th>
                  <th scope="col">{payerContracts.terms.RATE_BASIS}</th>
                  <th scope="col">{payerContracts.terms.RENEGOTIATION}</th>
                </tr>
              </thead>
              <tbody>
                {payerContracts.payers.map((entry) => (
                  <tr key={entry.payer} className="border-t border-border align-top">
                    <td>
                      {entry.payer} {entry.largestContracted ? <Badge variant="evidence">Largest contracted</Badge> : null}
                      <br />
                      {entry.state === 'EXPIRED_AT_CLOSE' || (entry.state === 'EXPIRES_WITHIN_YEAR' && entry.material) ? <Badge variant="danger">{CONTRACT_LABEL[entry.state]}</Badge> : <span className="text-xs text-muted-foreground">{CONTRACT_LABEL[entry.state]}</span>}
                    </td>
                    <td className="text-right" data-numeric>{percentOf(entry.share, 1)}</td>
                    <td>
                      {entry.agreement?.expiresOn ? (
                        <>
                          {entry.agreement.expiresOn}
                          {entry.monthsAfterClose !== null ? ` (${entry.monthsAfterClose} months after)` : ''} {entry.agreement.expiry ? cite(entry.agreement.expiry) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{entry.agreement ? quoted(entry.agreement.rateBasis) : '—'}</td>
                    <td>{entry.agreement ? quoted(entry.agreement.renegotiation) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              {payerContracts.measuredFrom
                ? payerContracts.measuredFrom.basis === 'EXPECTED_CLOSING'
                  ? <>Measured from the expected closing on {payerContracts.measuredFrom.date}{payerContracts.measuredFrom.source ? <> ({cite(payerContracts.measuredFrom.source)})</> : null}.</>
                  : `No document states a closing date, so terms are measured from ${payerContracts.measuredFrom.date}, the end of the latest month in the exports.`
                : 'No closing date and no exports yet.'}{' '}
              A contracted payer at {percentOf(payerContracts.materialShare, 0)} or more of net revenue whose agreement ends within {payerContracts.windowMonths} months of closing, with no automatic renewal, is drafted on Findings.
              {payerContracts.count > payerContracts.payers.length ? ` The largest ${payerContracts.payers.length} of ${payerContracts.count} payers shown.` : ''} A reading of the sentences, not legal advice.
            </p>
          </>
        )}
      </Section>

      <Section title="Medical staff" accent="plum">
        {medicalStaff.count === 0 ? (
          <p className="text-muted-foreground">No medical-staff register yet. Import it on Sources (Industry data): staff by pseudonymous reference, department, licence and privilege dates.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Medical staff by department, with lapsed privileges and expired licences at the analysis date</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Department</th>
                  <th scope="col" className="text-right">Staff</th>
                  <th scope="col" className="text-right">Privileges lapsed</th>
                  <th scope="col" className="text-right">Licences expired</th>
                </tr>
              </thead>
              <tbody>
                {medicalStaff.departments.map((department) => (
                  <tr key={department.department} className="border-t border-border">
                    <td>{department.department}</td>
                    <td className="text-right" data-numeric>{department.staff}</td>
                    <td className="text-right" data-numeric>{department.privilegesLapsed}</td>
                    <td className="text-right" data-numeric>{department.licencesExpired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {medicalStaff.clusters.map((cluster) => (
              <p key={`${cluster.department}:${cluster.date}`}>
                {cluster.state === 'LAPSED' ? <Badge variant="danger">Lapsed together</Badge> : <Badge variant="draft">Due together</Badge>} {cluster.department}: {cluster.staff.length} of {cluster.departmentSize} staff share the privilege date {cluster.date} ({cluster.staff.join(', ')}).
              </p>
            ))}
            {medicalStaff.exceptions.length ? (
              <ul className="flex flex-col gap-1 text-xs">
                {medicalStaff.exceptions.map((entry) => (
                  <li key={entry.staffRef}>
                    {entry.staffRef} ({entry.department}): {entry.privilegesLapsed ? `privileges lapsed (${entry.privilegesExpireOn ?? entry.privilegeStatus})` : null}
                    {entry.privilegesLapsed && entry.licenceExpired ? '; ' : null}
                    {entry.licenceExpired ? <>licence expired ({entry.licenceExpiresOn ?? 'register status'}){entry.licenceVerified ? <> {cite(entry.licenceVerified)}</> : null}</> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              At {view.analysisDate ?? 'the analysis date'}, the end of the latest month in the exports. {medicalStaff.clusterSize} or more of a department&apos;s staff sharing a privilege date that has passed, or falls within {medicalStaff.dueDays} days, is drafted on Findings; a verification document&apos;s licence date governs over the register.
              {medicalStaff.exceptionCount > medicalStaff.exceptions.length ? ` The first ${medicalStaff.exceptions.length} of ${medicalStaff.exceptionCount} exceptions shown.` : ''} Dates only, never a view on any physician.
            </p>
          </>
        )}
      </Section>

      <Section title="Plant and capex" accent="bronze">
        {plant.years.length === 0 ? (
          <p className="text-muted-foreground">No P&L with a capital spend line imported yet. Import one or more fiscal years on Sources (Profit and loss); every year imported is read.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Capital spend on plant and equipment as a share of revenue, by fiscal year</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Year</th>
                <th scope="col" className="text-right">Capital spend</th>
                <th scope="col" className="text-right">Revenue</th>
                <th scope="col" className="text-right">Capital spend ÷ revenue</th>
                <th scope="col">From</th>
              </tr>
            </thead>
            <tbody>
              {plant.years.map((year) => (
                <tr key={year.year} className="border-t border-border">
                  <td>{year.year}</td>
                  <td className="text-right" data-numeric>{money(year.amount)}</td>
                  <td className="text-right" data-numeric>{money(year.revenue)}</td>
                  <td className="text-right" data-numeric>{percentOf(year.ratio, 2)}</td>
                  <td className="text-xs text-muted-foreground">{year.files.map((file) => file.fileName).join(', ') || 'no file'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>{plant.claim ? <>The deck says: {quoted(plant.claim)}</> : <span className="text-muted-foreground">No document calls the plant modern or renovated.</span>}</p>
        {plant.assessments.length === 0 ? (
          <p className="text-muted-foreground">No property condition assessment in the documents; the intake checklist asks the seller for one.</p>
        ) : (
          plant.assessments.map((assessment) => (
            <div key={assessment.documentId} className="flex flex-col gap-1">
              <p>
                <strong>{assessment.documentName ?? 'Condition assessment'}</strong> {assessment.heading ? cite(assessment.heading) : null}
              </p>
              <ul className="flex flex-col gap-1">
                {assessment.statements.map((statement) => (statement ? <li key={statement.quote}>{quoted(statement)}</li> : null))}
              </ul>
              {assessment.deferredMaintenance ? <p>Deferred maintenance stated: {assessment.deferredMaintenance.currency} {grouped(assessment.deferredMaintenance.amount)}.</p> : null}
            </div>
          ))
        )}
        <p className="text-xs text-muted-foreground">Capital spend falling every year to {percentOf(plant.fallFactor, 0)} of its first year&apos;s ratio or less is drafted on Findings, priced at the deferred maintenance an assessment states. One year alone does not show it.</p>
      </Section>

      <Section title="Quality reporting" accent="violet">
        {quality.reports.length === 0 ? (
          <p className="text-muted-foreground">No quality-reporting document supplied. Upload the published reporting; until then a quality claim stays unverified.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {quality.reports.map((report) => (
              <li key={report.documentId}>
                <strong>{report.documentName ?? 'Quality reporting'}</strong>: {report.stars !== null ? `overall star rating ${report.stars}` : 'no overall star rating stated'} {report.source ? cite(report.source) : null}
              </li>
            ))}
          </ul>
        )}
        <ClaimList claims={quality.claims} cite={cite} empty="The deck and other seller documents claim no star rating." />
        <p className="text-xs text-muted-foreground">The stated rating against the reporting supplied: never a view on the quality of care, and never a prediction of a survey.</p>
      </Section>

      <Section title="P&L by year" accent="moss">
        {trend.years.length === 0 ? (
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
                  <th scope="col" className="text-right">Operating margin</th>
                  {trend.years[0]?.ratios.map((ratio) => (
                    <th key={ratio.key} scope="col" className="text-right">
                      {ratio.label} ÷ revenue
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trend.years.map((year) => (
                  <tr key={year.year} className="border-t border-border">
                    <td>{year.year}</td>
                    <td className="text-right" data-numeric>{money(year.revenue)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.revenueGrowth, 1)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.operatingMargin, 1)}</td>
                    {year.ratios.map((ratio) => (
                      <td key={ratio.key} className="text-right" data-numeric>{percentOf(ratio.ratio, 2)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {trend.years.length === 1 ? <p className="text-muted-foreground">One fiscal year imported: there is no trend yet. Import earlier years to read one.</p> : null}
            {trend.partialYears.length ? <p className="text-muted-foreground">Left out because not every month is imported: {trend.partialYears.join(', ')}.</p> : null}
          </>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">How this is computed</summary>
          <ul className="mt-1 list-disc pl-5">
            {trend.conventions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      </Section>

      {view.canRunChecks ? (
        <Section title="Hospital checks" accent="indigo">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over the census, payer mix, medical-staff register, the P&L and documents: the cost report against the deck and the P&L, payer contracts against the closing, departments whose privileges lapse together, capital spend across the years, quality claims and the multi-year trend, with the payer concentration, accreditation, physician dependence and regulatory capex checks. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run hospital checks</Button>
          </form>
        </Section>
      ) : null}
    </div>
  );
}

function ClaimList({ claims, cite, empty }: { claims: readonly Claim[]; cite: (source: Source) => ReactNode; empty: string }) {
  if (claims.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {claims.map((claim) => (
        <li key={`${claim.title}:${claim.statement}`}>
          <Badge variant={CLAIM_BADGE[claim.status]}>{CLAIM_LABEL[claim.status]}</Badge> “{claim.statement}” {claim.source ? cite(claim.source) : null}
          <br />
          <span className="text-xs text-muted-foreground">{claim.rationale}</span>
        </li>
      ))}
    </ul>
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
