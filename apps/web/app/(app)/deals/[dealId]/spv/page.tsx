import type { Page } from '@pactlab/contracts';
import { ACCREDITATION_STATUS_LABELS, ACCREDITATION_STATUSES, type AccreditationStatus, formatAmount } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../../_components/pager';
import { formatRatio } from '../../../metrics/_lib/format';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { dealViewer } from '../../_lib/viewer';
import { addSeat, inviteInvestor, publish, runChecks, saveVehicle, updateAccreditation, withdrawSeat } from './actions';

interface Citation {
  documentId: string;
  documentName: string | null;
  pageNumber: number;
  quote: string;
}
interface RoundCheck {
  version: string;
  currency: string | null;
  preRoundShares: string;
  pricePerShare: string | null;
  conversions: { securityId: string; instrument: string; principal: string; cap: string | null; discount: string | null; mfnFrom: string | null; price: string; basis: string; shares: string; proRata: boolean }[];
  conversionShares: string;
  newShares: string | null;
  roundSize: { stated: string | null; recomputed: string | null; ties: boolean | null };
  preMoney: { stated: string | null; recomputed: string | null; ties: boolean | null };
  postRoundShares: { stated: string | null; recomputed: string | null; difference: string | null; ties: boolean | null };
  explainedBy: string[] | null;
  postMoney: string | null;
  proRata: { securityId: string; holderRef: string; instrument: string }[];
  conventions: string[];
}
interface Economics {
  version: string;
  currency: string | null;
  commitments: string;
  managementFeeRate: string | null;
  managementFeeYears: string | null;
  carryRate: string | null;
  feeAmount: string | null;
  expenseAmount: string | null;
  invested: string | null;
  feeLoad: string | null;
  organizerCommitment: string | null;
  comparisons: { term: string; label: string; agreement: string | null; summary: string | null; matches: boolean | null }[];
  conventions: string[];
}
interface Scenarios {
  assumptions: { downside: string | null; base: string | null; upside: string | null };
  items: { scenario: string; exitMultiple: string; exitValue: string; vehicleShares: string; ownership: string; proceeds: string; carry: string; netToInvestors: string; netMultiple: string; label: string }[];
  unavailable: string | null;
}
type Claim = { statement: string; status: string; rationale: string | null };
interface InvestorContent {
  meta: { vehicleName: string; company: string; currency: string; guardrail: string; scenarioLabel: string; noInventedFigures: string; sections: Record<string, string> };
  claims: Claim[];
  capTable: RoundCheck;
  economics: Economics;
  scenarios: Scenarios;
}
interface SpvView {
  guardrail: string;
  noInventedFigures: string;
  scenarioLabel: string;
  canEdit: boolean;
  canPublish: boolean;
  currency: string;
  company: string;
  vehicle: { vehicleName: string; downside: string | null; base: string | null; upside: string | null } | null;
  documents: { documentId: string; documentName: string | null; kind: string }[];
  round: { check: RoundCheck; citations: { preMoney: Citation | null; postRoundShares: Citation | null } };
  claims: Claim[];
  economics: Economics;
  scenarios: Scenarios;
  sideLetters: { documentId: string; documentName: string | null; investorRef: string | null; effects: { kind: string; economic: boolean; value: string | null; citation: Citation | null }[]; disclosed: boolean }[];
  offering: { exemption: string | null; exemptionLabel: string | null; exemptionCitation: Citation | null; formD: Citation | null; seats: number; seatsSufficient: number | null };
  published: { version: number; publishedAt: string; contentSha256: string } | null;
}
interface Seat {
  id: string;
  label: string;
  reference: string;
  commitment: string | null;
  currency: string;
  status: string;
  accreditationStatus: AccreditationStatus;
  accreditationLabel: string;
  accreditationProvider: string | null;
  accreditationUrl: string | null;
  accreditationEvidence: string | null;
  sufficient: boolean | null;
  member: 'NONE' | 'INVITED' | 'JOINED';
}
interface Mine {
  guardrail: string;
  seat: { reference: string; label: string; commitment: string | null; currency: string; status: string; accreditationLabel: string; accreditationProvider: string | null };
  view: { version: number; publishedAt: string; contentSha256: string; content: InvestorContent } | null;
}

const OUTCOMES: Record<string, string> = {
  'ok-vehicle': 'Saved. The return scenarios now run on these exit paths.',
  'ok-seat': 'Seat added. Run the SPV checks to see whether every investor meets the vehicle’s exemption.',
  'ok-accreditation': 'Recorded. Pactlab tracks what the specialist found; it determines nothing.',
  'ok-withdrawn': 'Seat withdrawn. Its people no longer reach the pact.',
  'ok-invited': 'Invitation sent. They join this pact only, as that investor.',
  'ok-invited-unsent': 'Invitation created, but the email could not be sent. Try again later.',
  'already-invited': 'That address already has an invitation waiting.',
  reference: 'Another seat already has that reference.',
  vehicle: 'Name the vehicle first: the investor view needs it.',
  invalid: 'Check the fields and try again.',
  forbidden: 'Only the deal lead can publish the investor view.',
};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` };
  const published = outcome?.match(/^ok-published-(\d+)$/);
  if (published) return { [published[0]]: `Published version ${published[1]}. Investors now see it; it never changes.` };
  return OUTCOMES;
};
const grouped = (value: string | null) => {
  if (value === null) return '—';
  const [whole = '', fraction] = value.replace('-', '').split('.');
  return `${value.startsWith('-') ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction && /[1-9]/.test(fraction) ? `.${fraction.replace(/0+$/, '')}` : ''}`;
};
const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';
const CLAIM_BADGE: Record<string, 'reviewed' | 'danger' | 'draft'> = { VERIFIED: 'reviewed', CONTRADICTED: 'danger', UNVERIFIED: 'draft' };
const tie = (ties: boolean | null) => (ties === null ? <Badge variant="draft">not stated</Badge> : ties ? <Badge variant="reviewed">ties</Badge> : <Badge variant="danger">does not tie</Badge>);

/**
 * Startup equity SPV (T-141). The organizer sees the round verification, the claims register, the
 * vehicle economics, side letters, investor seats and the investor view; an investor sees only
 * their own seat and the latest published view. Diligence support only.
 */
export default async function SpvPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const viewer = await dealViewer(dealId);
  if (viewer.role === 'INVESTOR') return <InvestorPage dealId={dealId} />;

  const seatsAt = readPage(search, 'seats');
  const preview = search['preview'] === '1';
  const [result, seats, previewResult] = await Promise.all([
    apiGet<SpvView>(`/v1/deals/${dealId}/spv`),
    apiGet<Page<Seat>>(`/v1/deals/${dealId}/spv/seats?${pageApiQuery(seatsAt, 25)}`),
    preview ? apiGet<InvestorContent>(`/v1/deals/${dealId}/spv/investor-view/preview`) : Promise.resolve(null),
  ]);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : formatAmount(value, view.currency, { fraction: 'trim' }));
  const base = `/deals/${dealId}/spv`;
  const cite = (citation: Citation | null) =>
    citation ? (
      <span className="text-muted-foreground">
        <Link className="underline" href={`/deals/${dealId}/documents?documentId=${citation.documentId}&page=${citation.pageNumber}`}>
          {citation.documentName ?? 'Document'} p.{citation.pageNumber}
        </Link>
        : “{citation.quote}”
      </span>
    ) : null;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; investors see only the view you publish, and the startup never sees the investor list.
      </p>

      <Section title="The vehicle">
        {view.canEdit ? (
          <form action={saveVehicle.bind(null, dealId)} className="grid gap-2 sm:grid-cols-5">
            <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">
              Vehicle name
              <input name="vehicleName" required defaultValue={view.vehicle?.vehicleName ?? ''} className={inputClass} />
            </label>
            {(['downside', 'base', 'upside'] as const).map((key) => (
              <label key={key} className="flex flex-col gap-1 text-xs font-medium">
                {key === 'downside' ? 'Downside' : key === 'base' ? 'Base' : 'Upside'} exit (× post-money)
                <input name={`${key}Multiple`} defaultValue={view.vehicle?.[key] ?? ''} inputMode="decimal" placeholder="e.g. 3" className={inputClass} />
              </label>
            ))}
            <div className="sm:col-span-5">
              <Button type="submit" size="sm">
                Save the vehicle
              </Button>
            </div>
          </form>
        ) : (
          <p>{view.vehicle?.vehicleName ?? 'Not named yet.'}</p>
        )}
        <p className="text-xs text-muted-foreground">Exit paths are your stated assumptions: the company’s equity value at exit as a multiple of the round’s post-money. The scenarios below are computed from them, never promised.</p>
        {view.canEdit ? (
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit" size="sm" variant="outline">
              Run SPV checks
            </Button>
          </form>
        ) : null}
      </Section>

      <RoundSection check={view.round.check} money={money} citations={<>{cite(view.round.citations.postRoundShares)}</>} />
      <ClaimsSection claims={view.claims} />
      <EconomicsSection economics={view.economics} money={money} />
      <ScenariosSection scenarios={view.scenarios} money={money} label={view.scenarioLabel} />

      <Section title="Side letters (organizer only)">
        {view.sideLetters.length === 0 ? (
          <p className="text-muted-foreground">No side letters in the evidence.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.sideLetters.map((letter) => (
              <li key={letter.documentId} className="rounded-md border border-border p-2">
                <p>
                  <strong>{letter.investorRef ?? 'An investor'}</strong> — {letter.documentName ?? 'Side letter'} {letter.disclosed ? <Badge variant="reviewed">summary discloses side letters</Badge> : letter.effects.some((effect) => effect.economic) ? <Badge variant="danger">economics not disclosed</Badge> : null}
                </p>
                <ul className="list-disc pl-5">
                  {letter.effects.map((effect) => (
                    <li key={effect.kind}>
                      {effect.kind.toLowerCase().replaceAll('_', ' ')}
                      {effect.economic ? ' (economic)' : ''}: {cite(effect.citation)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">One investor’s terms never appear in another investor’s view: side letters are never part of the published view.</p>
      </Section>

      <Section title="Offering and accreditation">
        <p>
          {view.offering.exemptionLabel ? (
            <>
              <strong>{view.offering.exemptionLabel}</strong> {cite(view.offering.exemptionCitation)}
            </>
          ) : (
            'No document states the vehicle’s exemption yet.'
          )}
        </p>
        <p>{view.offering.formD ? <>Form D on file: {cite(view.offering.formD)}</> : <Badge variant="danger">No Form D filing evidence</Badge>}</p>
        {view.offering.seatsSufficient !== null ? (
          <p>
            {view.offering.seatsSufficient} of {view.offering.seats} active investor{view.offering.seats === 1 ? '' : 's'} recorded as enough for the exemption. Accreditation is tracked, never determined: verification is a specialist’s.
          </p>
        ) : null}
      </Section>

      <Section title="Investor seats">
        {seats.kind !== 'ok' ? (
          <ApiState result={seats} />
        ) : seats.data.items.length === 0 ? (
          <p className="text-muted-foreground">No seats yet. Add each investor below.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Investor seats</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Investor</th>
                  <th scope="col" className="text-right">Commitment</th>
                  <th scope="col">Accreditation</th>
                  <th scope="col">On the pact</th>
                </tr>
              </thead>
              <tbody>
                {seats.data.items.map((seat) => (
                  <tr key={seat.id} className="border-t border-border align-top">
                    <td>
                      {seat.label} <span className="text-xs text-muted-foreground">{seat.reference}</span> {seat.status === 'WITHDRAWN' ? <Badge variant="draft">withdrawn</Badge> : null}
                    </td>
                    <td className="text-right" data-numeric>{seat.commitment ? formatAmount(seat.commitment, seat.currency, { fraction: 'trim' }) : '—'}</td>
                    <td>
                      {seat.accreditationLabel} {seat.sufficient === false ? <Badge variant="danger">not enough for the exemption</Badge> : null}
                      {seat.accreditationUrl ? (
                        <>
                          {' '}
                          <a className="underline" href={seat.accreditationUrl} rel="noreferrer noopener" target="_blank">
                            {seat.accreditationProvider ?? 'Verification'}
                          </a>
                        </>
                      ) : null}
                      {view.canEdit && seat.status === 'ACTIVE' ? (
                        <details>
                          <summary className="cursor-pointer text-xs">Record accreditation</summary>
                          <form action={updateAccreditation.bind(null, dealId, seat.id)} className="mt-1 flex flex-col gap-1">
                            <select name="accreditationStatus" aria-label="Accreditation status" defaultValue={seat.accreditationStatus} className={inputClass}>
                              {ACCREDITATION_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {ACCREDITATION_STATUS_LABELS[status]}
                                </option>
                              ))}
                            </select>
                            <input name="accreditationProvider" aria-label="Verification provider" placeholder="Verification provider" defaultValue={seat.accreditationProvider ?? ''} className={inputClass} />
                            <input name="accreditationUrl" aria-label="Link to the verification" placeholder="https://…" defaultValue={seat.accreditationUrl ?? ''} className={inputClass} />
                            <input name="accreditationEvidence" aria-label="Evidence pointer" placeholder="Evidence pointer (e.g. letter ref.)" defaultValue={seat.accreditationEvidence ?? ''} className={inputClass} />
                            <Button type="submit" size="sm" variant="outline">
                              Record
                            </Button>
                          </form>
                        </details>
                      ) : null}
                    </td>
                    <td>
                      {seat.member === 'JOINED' ? 'Joined' : seat.member === 'INVITED' ? 'Invited' : 'Not invited'}
                      {view.canEdit && seat.status === 'ACTIVE' ? (
                        <>
                          <form action={inviteInvestor.bind(null, dealId, seat.id)} className="mt-1 flex gap-1">
                            <input name="email" type="email" required aria-label={`Invite to ${seat.reference}`} placeholder="email" className={inputClass} />
                            <Button type="submit" size="sm" variant="outline">
                              Invite
                            </Button>
                          </form>
                          <form action={withdrawSeat.bind(null, dealId, seat.id)} className="mt-1">
                            <Button type="submit" size="sm" variant="ghost">
                              Withdraw seat
                            </Button>
                          </form>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager label="Seat pages" base={base} links={pagerLinks({ ...seats.data, itemCount: seats.data.items.length }, seatsAt, keepParams(search), 'seats')} />
          </>
        )}
        {view.canEdit ? (
          <form action={addSeat.bind(null, dealId)} className="grid gap-2 sm:grid-cols-5">
            <input name="label" required aria-label="Investor name" placeholder="Investor (firm or person)" className={`${inputClass} sm:col-span-2`} />
            <input name="reference" required aria-label="Reference" placeholder="Reference, e.g. INV-06" className={inputClass} />
            <input name="commitment" aria-label="Commitment" placeholder={`Commitment (${view.currency})`} inputMode="decimal" className={inputClass} />
            <select name="accreditationStatus" aria-label="Accreditation status" className={inputClass}>
              {ACCREDITATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ACCREDITATION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <div className="sm:col-span-5">
              <Button type="submit" size="sm">
                Add seat
              </Button>
            </div>
          </form>
        ) : null}
      </Section>

      <Section title="Investor view">
        <p>
          Investors see a frozen, versioned snapshot of four sections only: the round claims register, the cap-table verification, the vehicle economics check and the return scenarios. Side letters, seats, findings and your own analysis never enter it.{' '}
          {view.published ? (
            <>
              Version {view.published.version} published {view.published.publishedAt.slice(0, 10)}.
            </>
          ) : (
            'Nothing published yet.'
          )}
        </p>
        <div className="flex gap-2">
          <Link className="text-sm underline" href={preview ? base : `${base}?preview=1`}>
            {preview ? 'Hide the preview' : 'Preview'}
          </Link>
          {view.canPublish ? (
            <form action={publish.bind(null, dealId)}>
              <Button type="submit" size="sm">
                Publish version {(view.published?.version ?? 0) + 1}
              </Button>
            </form>
          ) : null}
        </div>
        {previewResult ? previewResult.kind === 'ok' ? <InvestorSections content={previewResult.data} /> : <ApiState result={previewResult} /> : null}
      </Section>
    </div>
  );
}

/** An investor's own page: their seat, and the latest published view (nothing else of the pact). */
async function InvestorPage({ dealId }: { dealId: string }) {
  const result = await apiGet<Mine>(`/v1/deals/${dealId}/spv/mine`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const { seat, view, guardrail } = result.data;
  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {guardrail}
      </p>
      <Section title="Your seat">
        <p>
          {seat.label} <span className="text-xs text-muted-foreground">{seat.reference}</span> — commitment {seat.commitment ? formatAmount(seat.commitment, seat.currency, { fraction: 'trim' }) : 'not recorded'}; accreditation: {seat.accreditationLabel}
          {seat.accreditationProvider ? ` (${seat.accreditationProvider})` : ''}.
        </p>
      </Section>
      {view ? (
        <>
          <p className="text-sm text-muted-foreground">
            Investor view version {view.version}, published {view.publishedAt.slice(0, 10)} by the organizer of {view.content.meta.vehicleName}. It does not change once published.
          </p>
          <InvestorSections content={view.content} />
        </>
      ) : (
        <p className="text-muted-foreground">The organizer has not published the investor view yet.</p>
      )}
    </div>
  );
}

function InvestorSections({ content }: { content: InvestorContent }) {
  const money = (value: string | null) => (value === null ? '—' : formatAmount(value, content.meta.currency, { fraction: 'trim' }));
  return (
    <div className="flex flex-col gap-4">
      <ClaimsSection claims={content.claims} />
      <RoundSection check={content.capTable} money={money} citations={null} />
      <EconomicsSection economics={content.economics} money={money} />
      <ScenariosSection scenarios={content.scenarios} money={money} label={content.meta.scenarioLabel} />
    </div>
  );
}

function RoundSection({ check, money, citations }: { check: RoundCheck; money: (value: string | null) => string; citations: ReactNode }) {
  return (
    <Section title="Round verification">
      {check.pricePerShare === null ? (
        <p className="text-muted-foreground">No round summary states the price per share yet. Upload the round summary on Documents and import the cap table on Sources.</p>
      ) : (
        <>
          <table className="w-full text-left">
            <caption className="sr-only">The round, stated and recomputed</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Figure</th>
                <th scope="col" className="text-right">Stated</th>
                <th scope="col" className="text-right">Recomputed</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td>Pre-money (price × pre-round shares)</td>
                <td className="text-right" data-numeric>{money(check.preMoney.stated)}</td>
                <td className="text-right" data-numeric>{money(check.preMoney.recomputed)}</td>
                <td>{tie(check.preMoney.ties)}</td>
              </tr>
              <tr className="border-t border-border">
                <td>Round size (new shares × price)</td>
                <td className="text-right" data-numeric>{money(check.roundSize.stated)}</td>
                <td className="text-right" data-numeric>{money(check.roundSize.recomputed)}</td>
                <td>{tie(check.roundSize.ties)}</td>
              </tr>
              <tr className="border-t border-border">
                <td>Fully diluted shares after the round</td>
                <td className="text-right" data-numeric>{grouped(check.postRoundShares.stated)}</td>
                <td className="text-right" data-numeric>{grouped(check.postRoundShares.recomputed)}</td>
                <td>
                  {tie(check.postRoundShares.ties)} {check.explainedBy ? <span className="text-xs">off by exactly {check.explainedBy.join(' and ')}’s conversion</span> : null}
                </td>
              </tr>
            </tbody>
          </table>
          {citations}
          {check.conversions.length ? (
            <table className="w-full text-left">
              <caption className="text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">SAFE and note conversions</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Instrument</th>
                  <th scope="col" className="text-right">Principal</th>
                  <th scope="col">Terms</th>
                  <th scope="col" className="text-right">Price</th>
                  <th scope="col" className="text-right">Shares</th>
                  <th scope="col">Pro-rata</th>
                </tr>
              </thead>
              <tbody>
                {check.conversions.map((entry) => (
                  <tr key={entry.securityId} className="border-t border-border">
                    <td>{entry.securityId}</td>
                    <td className="text-right" data-numeric>{money(entry.principal)}</td>
                    <td>
                      {[entry.cap ? `cap ${money(entry.cap)}` : null, entry.discount ? `${formatRatio(entry.discount)} discount` : null, entry.mfnFrom ? `MFN from ${entry.mfnFrom}` : null].filter(Boolean).join(', ') || '—'} · converts on its {entry.basis === 'CAP' ? 'cap' : entry.basis === 'DISCOUNT' ? 'discount' : 'round price'}
                    </td>
                    <td className="text-right" data-numeric>{entry.price}</td>
                    <td className="text-right" data-numeric>{grouped(entry.shares)}</td>
                    <td>{entry.proRata ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <Conventions items={check.conventions} />
        </>
      )}
    </Section>
  );
}

function ClaimsSection({ claims }: { claims: Claim[] }) {
  return (
    <Section title="Round claims register">
      {claims.length === 0 ? (
        <p className="text-muted-foreground">No claims checked yet. Run the SPV checks.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {claims.map((claim) => (
            <li key={claim.statement}>
              <Badge variant={CLAIM_BADGE[claim.status] ?? 'draft'}>{claim.status.toLowerCase()}</Badge> “{claim.statement}” <span className="text-muted-foreground">{claim.rationale}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function EconomicsSection({ economics, money }: { economics: Economics; money: (value: string | null) => string }) {
  return (
    <Section title="Vehicle economics">
      <dl className="grid gap-3 sm:grid-cols-5">
        <Figure label="Commitments" value={money(economics.commitments)} />
        <Figure label="Management fee" value={money(economics.feeAmount)} />
        <Figure label="Expenses (at their cap)" value={money(economics.expenseAmount)} />
        <Figure label="Invested in the round" value={money(economics.invested)} />
        <Figure label="Fee load" value={formatRatio(economics.feeLoad)} />
      </dl>
      <table className="w-full text-left">
        <caption className="sr-only">Operating agreement against the investor summary</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col">Term</th>
            <th scope="col">Operating agreement</th>
            <th scope="col">Investor summary</th>
            <th scope="col">Check</th>
          </tr>
        </thead>
        <tbody>
          {economics.comparisons.map((comparison) => (
            <tr key={comparison.term} className="border-t border-border">
              <td>{comparison.label}</td>
              <td>{comparison.agreement ?? '—'}</td>
              <td>{comparison.summary ?? '—'}</td>
              <td>{comparison.matches === null ? <Badge variant="draft">not stated</Badge> : comparison.matches ? <Badge variant="reviewed">matches</Badge> : <Badge variant="danger">differs</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Conventions items={economics.conventions} />
    </Section>
  );
}

function ScenariosSection({ scenarios, money, label }: { scenarios: Scenarios; money: (value: string | null) => string; label: string }) {
  return (
    <Section title="Net-of-fees return scenarios">
      <p className="text-xs">
        <Badge variant="calculation">{label}</Badge>
      </p>
      {scenarios.unavailable ? (
        <p className="text-muted-foreground">{scenarios.unavailable}</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Return scenarios</caption>
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col">Scenario</th>
              <th scope="col" className="text-right">Exit (× post-money)</th>
              <th scope="col" className="text-right">Vehicle’s share</th>
              <th scope="col" className="text-right">Proceeds</th>
              <th scope="col" className="text-right">Carry</th>
              <th scope="col" className="text-right">Net to investors</th>
              <th scope="col" className="text-right">Net multiple</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.items.map((item) => (
              <tr key={item.scenario} className="border-t border-border">
                <td>{item.scenario.charAt(0) + item.scenario.slice(1).toLowerCase()}</td>
                <td className="text-right" data-numeric>{item.exitMultiple}×</td>
                <td className="text-right" data-numeric>{formatRatio(item.ownership)}</td>
                <td className="text-right" data-numeric>{money(item.proceeds)}</td>
                <td className="text-right" data-numeric>{money(item.carry)}</td>
                <td className="text-right" data-numeric>{money(item.netToInvestors)}</td>
                <td className="text-right" data-numeric>{item.netMultiple}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
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
