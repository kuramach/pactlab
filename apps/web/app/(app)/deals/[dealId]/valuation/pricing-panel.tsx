import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../../_lib/api';
import { can, type DealViewer } from '../../_lib/viewer';
import { formatMoney } from '../../../metrics/_lib/format';
import {
  CASE_LABELS,
  formatDelta,
  latestByPersona,
  LEVER_LABELS,
  type EvaluationView,
  type PricingView,
  type TermBatchView,
  type TermLever,
} from '../../../valuation/_lib/pricing';
import { adoptEvaluation, draftBrief, draftTerms, evaluateAs, proposeTerms, saveSellerNotes, setPactPersona } from './pricing-actions';

export const PRICING_OUTCOMES: Record<string, string> = {
  'ok-evaluated': 'Evaluated under the new persona. The findings and earlier runs are unchanged.',
  'ok-adopted': 'Adopted as the active pricing. Nothing changes for the seller until you propose terms.',
  'ok-persona': 'Persona saved for this pact.',
  'ok-drafted': 'Terms drafted from the active pricing. Add notes for the seller, then propose.',
  'ok-notes': 'Seller notes saved.',
  'ok-proposed': 'Terms proposed to the seller. They are frozen; draft a new version to change them.',
  'ok-brief': 'Negotiation brief drafted. It is for your team only.',
  'ok-case': 'Scenario case saved.',
  'pricing-no-scenario': 'Create a valuation scenario (and tag Downside, Base or Upside) before pricing under a persona.',
  'adopt-first': 'Adopt a pricing evaluation before drafting terms.',
  'terms-frozen': 'Those terms were already proposed and are frozen. Draft a new version.',
  'brief-unavailable': 'The brief could not be drafted right now. Try again shortly.',
  'brief-no-findings': 'The active pricing carries no accepted findings to brief on.',
};

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const leverTotal = (evaluation: EvaluationView, lever: TermLever) =>
  evaluation.termMix.lines.filter((line) => line.lever === lever).reduce((total, line) => total + Number(line.amount.amount), 0);

function Delta({ value }: { value: string | undefined }) {
  const text = formatDelta(value);
  return text === 'same' ? null : <span className="block text-xs text-muted-foreground">{text} vs active</span>;
}

function Compare({ dealId, view, writer }: { dealId: string; view: PricingView; writer: boolean }) {
  const columns = latestByPersona(view.evaluations, view.persona.options.map((option) => option.persona));
  if (columns.length === 0) return <p className="text-sm text-muted-foreground">No evaluation yet. Evaluate the pact under a persona to see its price and terms.</p>;
  const levers = [...new Set(columns.flatMap((column) => column.termMix.lines.map((line) => line.lever)))];
  const rows: { label: string; value: (evaluation: EvaluationView) => string; delta: (evaluation: EvaluationView) => string | undefined; strong?: boolean }[] = [
    { label: 'Price (weighted)', value: (e) => formatMoney(e.termMix.price), delta: (e) => e.deltaToActive?.price, strong: true },
    { label: 'Holdbacks', value: (e) => formatMoney(e.termMix.holdbacks), delta: (e) => e.deltaToActive?.holdbacks },
    { label: 'Earnout', value: (e) => formatMoney(e.termMix.earnout), delta: (e) => e.deltaToActive?.earnout },
    { label: 'Seller note', value: (e) => formatMoney(e.termMix.sellerFinancing), delta: (e) => e.deltaToActive?.sellerFinancing },
    { label: 'Cash at close', value: (e) => formatMoney(e.termMix.cashAtClose), delta: (e) => e.deltaToActive?.cashAtClose, strong: true },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-2 pr-4 font-medium text-muted-foreground">Compare</th>
            {columns.map((column) => (
              <th key={column.id} className="py-2 pr-4 align-bottom">
                <span className="block font-semibold">{column.personaLabel}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {column.cases.map((entry) => CASE_LABELS[entry.case]).join(' · ')} · {column.createdAt.slice(0, 10)}
                </span>
                {view.active?.evaluationId === column.id ? (
                  <Badge variant="reviewed" className="mt-1">active</Badge>
                ) : writer ? (
                  <form action={adoptEvaluation.bind(null, dealId, column.id)} className="mt-1">
                    <Button size="sm" variant="outline" type="submit">
                      Adopt
                    </Button>
                  </form>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.label} className={row.strong ? 'font-medium' : ''}>
              <td className="py-1.5 pr-4">{row.label}</td>
              {columns.map((column) => (
                <td key={column.id} className="py-1.5 pr-4">
                  {row.value(column)}
                  <Delta value={row.delta(column)} />
                </td>
              ))}
            </tr>
          ))}
          {levers.map((lever) => (
            <tr key={lever} className="text-muted-foreground">
              <td className="py-1.5 pr-4 pl-3">↳ {LEVER_LABELS[lever]}</td>
              {columns.map((column) => (
                <td key={column.id} className="py-1.5 pr-4">
                  {leverTotal(column, lever) > 0 ? formatMoney({ amount: leverTotal(column, lever).toFixed(2), currency: column.termMix.currency }) : '—'}
                  <Delta value={column.deltaToActive?.levers[lever]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Terms({ dealId, view, writer, titles }: { dealId: string; view: PricingView; writer: boolean; titles: ReadonlyMap<string, string> }) {
  const latest: TermBatchView | undefined = view.batches[0];
  const proposed = view.batches.find((batch) => batch.proposedAt);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-bold">Proposed terms</h3>
        {proposed ? <Badge variant="evidence">seller sees v{proposed.version}</Badge> : <Badge variant="draft">nothing proposed yet</Badge>}
      </div>
      {view.sellerSeesOtherPricing ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          The seller still sees v{proposed?.version} from an earlier pricing. Draft and propose new terms to change what they see.
        </p>
      ) : null}
      {latest && !latest.proposedAt ? (
        <form action={saveSellerNotes.bind(null, dealId, latest.id)} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Draft v{latest.version}. The seller sees each term’s lever, amount and your note, and nothing about how it was priced.</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {latest.terms.map((term) => (
                <tr key={term.ordinal}>
                  <td className="w-48 py-2 pr-3 font-medium">{LEVER_LABELS[term.lever]}</td>
                  <td className="w-40 py-2 pr-3">{formatMoney({ amount: term.amount, currency: term.currency })}</td>
                  <td className="py-2">
                    <input name={`note-${term.ordinal}`} defaultValue={term.sellerNote} maxLength={1000} placeholder="Note for the seller (optional)" className={inputClass} disabled={!writer} />
                    {term.findingId ? <span className="mt-1 block text-xs text-muted-foreground">Carries: {titles.get(term.findingId) ?? 'accepted finding'} (buyer-only)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {writer ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" type="submit">
                Save notes
              </Button>
              <Button size="sm" type="submit" formAction={proposeTerms.bind(null, dealId, latest.id)}>
                Propose to seller (v{latest.version})
              </Button>
            </div>
          ) : null}
        </form>
      ) : writer && view.active ? (
        <form action={draftTerms.bind(null, dealId)}>
          <Button size="sm" variant="outline" type="submit">
            Draft terms from the active pricing
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function Brief({ dealId, view, writer, titles }: { dealId: string; view: PricingView; writer: boolean; titles: ReadonlyMap<string, string> }) {
  if (!view.active) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-bold">Negotiation brief</h3>
        <Badge variant="neutral">buyer-only · AI draft</Badge>
        {writer ? (
          <form action={draftBrief.bind(null, dealId, view.active.evaluationId)}>
            <Button size="sm" variant="outline" type="submit">
              {view.brief ? 'Redraft' : 'Draft brief'}
            </Button>
          </form>
        ) : null}
      </div>
      {view.brief ? (
        <ol className="flex flex-col gap-3 text-sm">
          {view.brief.sections.map((section, index) => (
            <li key={index} className="flex flex-col gap-1">
              <span className="font-semibold">{section.heading}</span>
              <span>{section.body}</span>
              <span className="flex flex-wrap gap-1">
                {section.citedFindingIds.map((id) => (
                  <Link key={id} href={`/deals/${dealId}/findings/${id}`}>
                    <Badge variant="reviewed">{titles.get(id) ?? 'accepted finding'}</Badge>
                  </Link>
                ))}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">A short framing of the active terms in this persona’s tone, every point citing an accepted finding. Amounts stay in the table above.</p>
      )}
    </section>
  );
}

/**
 * Buyer personas (T-105): price the same accepted findings through another
 * lens in one action, compare against the active pricing, adopt one, propose
 * versioned terms to the seller and draft the brief. Buyer-only.
 */
export async function PricingPanel({ dealId, viewer }: { dealId: string; viewer: DealViewer }) {
  const [result, accepted] = await Promise.all([
    apiGet<PricingView>(`/v1/deals/${encodeURIComponent(dealId)}/pricing`),
    apiGet<{ items: { id: string; title: string }[] }>(`/v1/deals/${encodeURIComponent(dealId)}/findings?status=ACCEPTED`),
  ]);
  if (result.kind !== 'ok') return null;
  const view = result.data;
  const writer = can.draft(viewer.role);
  const titles = new Map((accepted.kind === 'ok' ? accepted.data.items : []).map((finding) => [finding.id, finding.title]));
  const label = (persona: string) => view.persona.options.find((option) => option.persona === persona)?.label ?? persona;
  const active = view.evaluations.find((evaluation) => evaluation.id === view.active?.evaluationId);

  return (
    <Card id="pricing">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle className="mr-auto">Priced as: {active ? active.personaLabel : label(view.persona.effective)}</CardTitle>
        <Badge variant="neutral">buyer-only</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        <p className="text-muted-foreground">
          The same accepted findings, priced through a buyer’s deal-making style. Evaluating under another persona adds a new run; findings and earlier runs never change, and nothing reaches the seller until you propose terms.
        </p>
        {writer ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-3">
              {view.persona.options.map((option) => (
                <form key={option.persona} action={evaluateAs.bind(null, dealId)} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <input type="hidden" name="persona" value={option.persona} />
                  <span className="font-semibold">
                    {option.label}
                    {option.persona === view.persona.effective ? <Badge variant="neutral" className="ml-2">this pact</Badge> : null}
                  </span>
                  <span className="text-muted-foreground">{option.descriptor}</span>
                  <Button size="sm" variant={option.persona === view.persona.effective ? 'default' : 'outline'} type="submit" className="mt-auto self-start">
                    Evaluate as {option.label}
                  </Button>
                </form>
              ))}
            </div>
            <form action={setPactPersona.bind(null, dealId)} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">This pact’s persona</span>
                <select name="persona" defaultValue={view.persona.pact ?? ''} className={inputClass}>
                  <option value="">Organization default ({label(view.persona.organizationDefault ?? 'VALUE_INVESTOR')})</option>
                  {view.persona.options.map((option) => (
                    <option key={option.persona} value={option.persona}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="ghost" type="submit">
                Save
              </Button>
            </form>
          </div>
        ) : null}

        <Compare dealId={dealId} view={view} writer={writer} />
        <Terms dealId={dealId} view={view} writer={writer} titles={titles} />
        <Brief dealId={dealId} view={view} writer={writer} titles={titles} />
      </CardContent>
    </Card>
  );
}
