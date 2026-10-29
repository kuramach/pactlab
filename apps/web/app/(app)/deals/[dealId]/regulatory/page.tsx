import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { addEntry, proposeFindings } from './actions';

interface RegFinding {
  check: string;
  phase: 'PRE' | 'DILIGENCE';
  title: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

interface RegulatoryView {
  pack: { id: string; label: string };
  depth: 'FULL' | 'LIGHT';
  authorities: { name: string; scope: string; theoryOfHarm: string }[];
  inputs: { sites: number; packageSites: number; packageRevision: number | null; terms: boolean; buyer: boolean; feedbackRounds: number; revisions: number; commitments: number };
  clearance: { band: 'GO' | 'GO_WITH_REMEDY_PRICED' | 'NO_GO'; reasons: string[] };
  markets: { overlapping: number; presumed: number; top: { market: string; hhiBefore: number; hhiAfter: number; delta: number; mergedShare: string; firmsAfter: number; presumed: boolean }[] };
  coherence: { score: number; banners: number; distributionCovered: string; systemsCovered: string; patchworkRegions: string[] } | null;
  certainty: { elapsedDays: number; daysToOutsideDate: number; feeExposure: { ACQUIRER: string; TARGET: string }; divestitureCap: number; outsideDate: string; effortsStandard: string; currency: string } | null;
  commitments: { id: string; text: string; grade: 'VERIFIABLE' | 'PARTIAL' | 'UNVERIFIABLE' }[];
  findings: RegFinding[];
  entries: { id: string; kind: string; citation: { documentId: string; pageNumber: number; quote: string }; createdAt: string }[];
}

const BAND: Record<RegulatoryView['clearance']['band'], { label: string; tone: 'reviewed' | 'draft' | 'danger'; detail: string }> = {
  GO: { label: 'GO', tone: 'reviewed', detail: 'Nothing in the Pre-screen calls for a remedy.' },
  GO_WITH_REMEDY_PRICED: { label: 'GO — with the remedy priced', tone: 'draft', detail: 'Overlap calls for a remedy: price it into the bridge from day one, not at month 20.' },
  NO_GO: { label: 'NO-GO as it stands', tone: 'danger', detail: 'The overlap needs a remedy, and the remedy as offered has a critical defect.' },
};
const TONE = { LOW: 'neutral', MEDIUM: 'draft', HIGH: 'danger', CRITICAL: 'danger' } as const;
const OUTCOMES: Record<string, string> = {
  'ok-entry': 'Entry added, with its citation.',
  citation: 'That quote is not on the cited page. Copy it exactly from the document.',
  'entry-invalid': 'Some fields were not accepted. Check dates (YYYY-MM-DD), numbers and topics.',
  nothing: 'Nothing to record yet: import the footprint, or add entries.',
  forbidden: 'Your role cannot change this deal.',
};
const pct = (value: string) => `${(Number(value) * 100).toFixed(1)}%`;
const money = (currency: string, value: string) => `${currency} ${Number(value).toLocaleString('en-US')}`;
const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';

/**
 * Regulatory & deal certainty (T-091): the Pre-screen (who can block this
 * deal, local-market concentration, labor), the remedy workbench, the
 * covenant countdown and pledge quality. Risk surfacing — never a probability
 * of clearance, and not legal advice. Every check shows what it read.
 */
export default async function RegulatoryPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const [result, documents] = await Promise.all([
    apiGet<RegulatoryView>(`/v1/deals/${dealId}/regulatory`),
    apiGet<{ items: { id: string; fileName: string; pageCount: number }[] }>(`/v1/deals/${dealId}/documents`),
  ]);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const proposed = typeof outcome === 'string' ? /^ok-proposed-(\d+)-(\d+)$/.exec(outcome) : null;
  const band = BAND[view.clearance.band];
  const pre = view.findings.filter((finding) => finding.phase === 'PRE');
  const diligence = view.findings.filter((finding) => finding.phase === 'DILIGENCE');
  const docs = documents.kind === 'ok' ? documents.data.items : [];

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner
        outcome={proposed ? 'ok-proposed' : typeof outcome === 'string' ? outcome : undefined}
        messages={{ ...OUTCOMES, 'ok-proposed': `Recorded in the findings register: ${proposed?.[1] ?? 0} new draft(s), ${proposed?.[2] ?? 0} already there. Review and price them on Findings.` }}
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Clearance risk</CardTitle>
          <form action={proposeFindings.bind(null, dealId)}>
            <Button type="submit" size="sm" disabled={view.findings.length === 0 && !view.certainty}>
              Add to findings register
            </Button>
          </form>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={band.tone}>{band.label}</Badge>
            <span className="text-muted-foreground">{band.detail}</span>
          </div>
          {view.clearance.reasons.length > 0 ? (
            <ul className="list-disc pl-5">
              {view.clearance.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            A band, not a probability: it follows only from the findings below. It feeds the Pre-phase verdict on{' '}
            <Link href={`/deals/${dealId}/screening`} className="underline">
              Screening
            </Link>
            ; people decide. Not legal advice.
          </p>
        </CardContent>
      </Card>

      <Section title={`Who can block or condition this deal (${view.pack.label}${view.depth === 'LIGHT' ? ', light screen' : ''})`}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {view.authorities.map((authority) => (
            <li key={authority.name} className="rounded-md border border-border p-3">
              <div className="font-medium">{authority.name}</div>
              <div className="text-xs text-muted-foreground">{authority.scope}</div>
              <div className="mt-1 text-xs">Theory of harm: {authority.theoryOfHarm}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Inputs">
        <ul className="grid gap-1 sm:grid-cols-2">
          <Input done={view.inputs.sites > 0} label={`Site footprint: ${view.inputs.sites.toLocaleString('en-US')} sites`} hint={<Link href={`/deals/${dealId}/sources`} className="underline">Import on Sources → Site footprint</Link>} />
          <Input done={view.inputs.packageSites > 0} label={`Divestiture package: ${view.inputs.packageSites} sites${view.inputs.packageRevision ? ` (revision ${view.inputs.packageRevision})` : ''}`} hint={<Link href={`/deals/${dealId}/sources`} className="underline">Import on Sources → Divestiture package</Link>} />
          <Input done={view.inputs.terms} label="Agreement certainty terms" hint="Add below, citing the agreement" />
          <Input done={view.inputs.buyer} label="Remedy buyer" hint="Add below" />
          <Input done={view.inputs.feedbackRounds > 0} label={`Regulator feedback: ${view.inputs.feedbackRounds} round(s), ${view.inputs.revisions} revision(s)`} hint="Add below" />
          <Input done={view.inputs.commitments > 0} label={`Pledges: ${view.inputs.commitments}`} hint="Add below" />
        </ul>
      </Section>

      {view.depth === 'FULL' ? (
        <Section title={`Pre-screen: ${view.markets.presumed} of ${view.markets.overlapping} overlapping local markets meet the 2023 Merger Guidelines presumption`}>
          <Findings items={pre} empty="No Pre-screen findings." />
          {view.markets.top.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Local market</th>
                    <th className="py-1 pr-3 font-medium">HHI before → after</th>
                    <th className="py-1 pr-3 font-medium">Change</th>
                    <th className="py-1 pr-3 font-medium">Merged share</th>
                    <th className="py-1 pr-3 font-medium">Full-service firms after</th>
                    <th className="py-1 pr-3 font-medium">Presumption</th>
                  </tr>
                </thead>
                <tbody>
                  {view.markets.top.map((market) => (
                    <tr key={market.market} className="border-t border-border">
                      <td className="py-1 pr-3">{market.market}</td>
                      <td className="py-1 pr-3 tabular-nums">
                        {market.hhiBefore.toLocaleString('en-US')} → {market.hhiAfter.toLocaleString('en-US')}
                      </td>
                      <td className="py-1 pr-3 tabular-nums">+{market.delta.toLocaleString('en-US')}</td>
                      <td className="py-1 pr-3 tabular-nums">{pct(market.mergedShare)}</td>
                      <td className="py-1 pr-3 tabular-nums">{market.firmsAfter}</td>
                      <td className="py-1 pr-3">{market.presumed ? <Badge variant="danger">Met</Badge> : <Badge variant="neutral">Not met</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted-foreground">The 15 largest increases. Source: DOJ/FTC Merger Guidelines (18 December 2023), Guideline 1 — HHI above 1,800 with a change above 100, or a share above 30% with a change above 100.</p>
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title="Remedy workbench and feedback log">
        <Findings items={diligence} empty="No workbench findings." />
        {view.coherence ? (
          <p className="text-xs text-muted-foreground">
            Package coherence {view.coherence.score}/100: {view.coherence.banners} banners; {pct(view.coherence.distributionCovered)} of sites keep their distribution center, {pct(view.coherence.systemsCovered)} their systems
            {view.coherence.patchworkRegions.length > 0 ? `; patchwork regions: ${view.coherence.patchworkRegions.join(', ')}` : ''}.
          </p>
        ) : null}
      </Section>

      {view.certainty ? (
        <Section title="Covenants and deal certainty">
          <dl className="grid gap-3 sm:grid-cols-4">
            <Stat label="Deal age" value={`${view.certainty.elapsedDays} days`} />
            <Stat label="Outside date" value={`${view.certainty.outsideDate} (${view.certainty.daysToOutsideDate >= 0 ? `${view.certainty.daysToOutsideDate} days left` : `${-view.certainty.daysToOutsideDate} days past`})`} />
            <Stat label="Divestiture cap" value={`${view.certainty.divestitureCap} sites (${view.inputs.packageSites} offered)`} />
            <Stat label="Fee the acquirer could owe" value={money(view.certainty.currency, view.certainty.feeExposure.ACQUIRER)} />
          </dl>
          <p className="text-xs text-muted-foreground">Efforts standard: {view.certainty.effortsStandard.replaceAll('_', ' ').toLowerCase()}. “Add to findings register” turns the fee and the remedy cost into priced lines a reviewer confirms for the bridge.</p>
        </Section>
      ) : null}

      {view.commitments.length > 0 ? (
        <Section title="Pledges">
          <ul className="flex flex-col gap-1">
            {view.commitments.map((commitment) => (
              <li key={commitment.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{commitment.text}</span>
                <Badge variant={commitment.grade === 'VERIFIABLE' ? 'reviewed' : commitment.grade === 'PARTIAL' ? 'draft' : 'danger'}>{commitment.grade.toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">An unverifiable pledge earns no credit with a regulator and is left out of any regulator-facing case.</p>
        </Section>
      ) : null}

      <Section title="Add a cited entry">
        <p className="text-xs text-muted-foreground">Every entry cites the document page it comes from: pick the document, the page, and copy the passage exactly.</p>
        {(
          [
            ['TERMS', 'Agreement certainty terms', [['signedOn', 'Signed on (YYYY-MM-DD)'], ['outsideDate', 'Outside date (YYYY-MM-DD)'], ['effortsStandard', 'Efforts: REASONABLE_BEST_EFFORTS, HELL_OR_HIGH_WATER or COMMERCIALLY_REASONABLE'], ['divestitureCap', 'Divestiture cap (sites)'], ['currency', 'Currency'], ['fee', 'Termination fee'], ['feePayer', 'Fee payer: ACQUIRER or TARGET'], ['ebitdaMultiple', 'EBITDA multiple for divested sites (optional)']]],
            ['BUYER', 'Remedy buyer', [['name', 'Name'], ['retailSitesOperated', 'Sites it runs today'], ['yearsOperatingRetail', 'Years operating them'], ['precedentYear', 'Precedent year (optional)'], ['precedentNote', 'Precedent (optional)'], ['precedentSource', 'Precedent source (optional)']]],
            ['FEEDBACK', 'Regulator feedback', [['round', 'Round'], ['date', 'Date (YYYY-MM-DD)'], ['regulator', 'Regulator'], ['topic', 'Topic (e.g. SIZE, COHERENCE, BUYER)'], ['substance', 'What they said']]],
            ['REVISION', 'Package revision', [['revision', 'Revision'], ['date', 'Date (YYYY-MM-DD)'], ['addresses', 'Topics it answers (comma-separated)']]],
            ['COMMITMENT', 'Pledge', [['text', 'The pledge'], ['measurement', 'How it is measured (if at all)'], ['enforcementParty', 'Who can enforce it (if anyone)'], ['durationMonths', 'Term in months (if any)']]],
          ] as const
        ).map(([kind, label, fields]) => (
          <details key={kind} className="rounded-md border border-border p-3">
            <summary className="cursor-pointer font-medium">{label}</summary>
            <form action={addEntry.bind(null, dealId, kind)} className="mt-2 grid gap-2 sm:grid-cols-2">
              {fields.map(([name, placeholder]) => (
                <input key={name} name={name} placeholder={placeholder} aria-label={placeholder} className={inputClass} />
              ))}
              <select name="documentId" required aria-label="Cited document" className={inputClass}>
                {docs.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.fileName}
                  </option>
                ))}
              </select>
              <input name="pageNumber" placeholder="Page" defaultValue="1" aria-label="Cited page" className={inputClass} />
              <input name="quote" required placeholder="Passage, copied exactly" aria-label="Cited passage" className={`${inputClass} sm:col-span-2`} />
              <div>
                <Button type="submit" size="sm" variant="outline">
                  Add {label.toLowerCase()}
                </Button>
              </div>
            </form>
          </details>
        ))}
      </Section>
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

function Findings({ items, empty }: { items: readonly RegFinding[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((finding) => (
        <li key={`${finding.check}:${finding.title}`} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{finding.title}</span>
            <Badge variant={TONE[finding.severity]}>{finding.severity.toLowerCase()}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">{finding.description}</p>
        </li>
      ))}
    </ul>
  );
}

function Input({ done, label, hint }: { done: boolean; label: string; hint: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <span>{label}</span>
      <span className="flex items-center gap-2 text-xs">
        {done ? null : <span className="text-muted-foreground">{hint}</span>}
        <Badge variant={done ? 'reviewed' : 'neutral'}>{done ? 'In' : 'Missing'}</Badge>
      </span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
