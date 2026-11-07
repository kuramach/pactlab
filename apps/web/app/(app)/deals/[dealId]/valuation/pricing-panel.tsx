import { AiBadge, Badge, Button, Card, CardContent, CardHeader, CardTitle, HumanBadge } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../../_lib/api';
import { can, type DealViewer } from '../../_lib/viewer';
import { formatMoney } from '../../../metrics/_lib/format';
import { PersonaCard, PersonaIcon } from '../../../valuation/_lib/persona-card';
import {
  CASE_LABELS,
  DECISION_LABELS,
  formatDelta,
  latestByPersona,
  LEVER_LABELS,
  pricingMessage,
  type EvaluationView,
  type PricingView,
  type TermBatchView,
  type TermLever,
} from '../../../valuation/_lib/pricing';
import { acceptCounters, adoptEvaluation, draftBrief, draftTerms, evaluateAs, proposeTerms, saveSellerNotes, setPactPersona } from './pricing-actions';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** The result of the last action, shown inside the section it came from (batch 1: never only at the top of the page). */
function Notice({ outcome, section }: { outcome: string | undefined; section: 'evaluate' | 'terms' | 'brief' }) {
  const message = pricingMessage(outcome, section);
  if (!message) return null;
  return (
    <p role={message.tone === 'ok' ? 'status' : 'alert'} className={`rounded-md border px-3 py-2 text-sm ${message.tone === 'ok' ? 'border-teal/40 bg-teal/10' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
      {message.text}
    </p>
  );
}

const leverTotal = (evaluation: EvaluationView, lever: TermLever) =>
  evaluation.termMix.lines.filter((line) => line.lever === lever).reduce((total, line) => total + Number(line.amount.amount), 0);

function Delta({ value }: { value: string | undefined }) {
  const text = formatDelta(value);
  return text === 'same' ? null : <span className="block text-xs text-muted-foreground">{text} vs active</span>;
}

function Compare({ dealId, view, writer }: { dealId: string; view: PricingView; writer: boolean }) {
  const columns = latestByPersona(view.evaluations, view.persona.options.map((option) => option.persona));
  if (columns.length === 0) return <p className="text-sm text-muted-foreground">No evaluation yet. Evaluate the pact under a persona to see its price and terms.</p>;
  const option = (persona: string) => view.persona.options.find((entry) => entry.persona === persona);
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
            {columns.map((column) => {
              const persona = option(column.persona);
              return (
                <th key={column.id} className="py-2 pr-4 align-bottom">
                  <span className="flex items-center gap-2 font-semibold">
                    {persona ? <PersonaIcon icon={persona.icon} className="h-4 w-4" /> : null}
                    {column.personaLabel}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {column.cases.map((entry) => CASE_LABELS[entry.case]).join(' · ')} · {column.createdAt.slice(0, 10)}
                  </span>
                  {view.active?.evaluationId === column.id ? (
                    <HumanBadge className="mt-1">Adopted</HumanBadge>
                  ) : writer ? (
                    <form action={adoptEvaluation.bind(null, dealId, column.id)} className="mt-1">
                      <Button size="sm" variant="outline" type="submit">
                        Adopt
                      </Button>
                    </form>
                  ) : null}
                </th>
              );
            })}
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

/** The seller's latest answer to one term, as the buyer sees it. */
function SellerAnswer({ response, currency }: { response: TermBatchView['terms'][number]['response']; currency: string }) {
  if (!response) return <span className="text-xs text-muted-foreground">No answer yet</span>;
  return (
    <span className="flex flex-col gap-0.5 text-xs">
      <span>
        <Badge variant={response.decision === 'ACCEPT' ? 'reviewed' : response.decision === 'REJECT' ? 'danger' : 'draft'}>{DECISION_LABELS[response.decision]}</Badge>
        {response.counterAmount ? <span className="ml-2 font-medium">{formatMoney({ amount: response.counterAmount, currency })}</span> : null}
      </span>
      {response.note ? <span className="text-muted-foreground">“{response.note}”</span> : null}
    </span>
  );
}

function Terms({ dealId, view, writer, titles, outcome }: { dealId: string; view: PricingView; writer: boolean; titles: ReadonlyMap<string, string>; outcome: string | undefined }) {
  const latest: TermBatchView | undefined = view.batches[0];
  const proposed = view.batches.find((batch) => batch.proposedAt);
  const agreed = view.batches.find((batch) => batch.agreedAt);
  const countered = proposed && !proposed.agreedAt && proposed.terms.some((term) => term.response?.decision === 'COUNTER');
  return (
    <section id="pricing-terms" className="flex scroll-mt-24 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-bold">Proposed terms</h3>
        {agreed ? <HumanBadge>Agreed v{agreed.version}</HumanBadge> : proposed ? <Badge variant="evidence">seller sees v{proposed.version}</Badge> : <Badge variant="draft">nothing proposed yet</Badge>}
      </div>
      <Notice outcome={outcome} section="terms" />
      {view.sellerSeesOtherPricing && !agreed ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          The seller still sees v{proposed?.version} from an earlier pricing. Draft and propose new terms to change what they see.
        </p>
      ) : null}

      {proposed && (proposed === latest || !latest || latest.proposedAt) ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            v{proposed.version}, proposed {proposed.proposedAt?.slice(0, 10)}
            {proposed.agreedAt ? `, agreed ${proposed.agreedAt.slice(0, 10)}` : ''}. The seller’s answers:
          </p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {proposed.terms.map((term) => (
                <tr key={term.ordinal}>
                  <td className="w-48 py-2 pr-3 font-medium">{LEVER_LABELS[term.lever]}</td>
                  <td className="w-40 py-2 pr-3">{formatMoney({ amount: term.amount, currency: term.currency })}</td>
                  <td className="py-2">
                    <SellerAnswer response={term.response} currency={term.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {writer && countered ? (
            <form action={acceptCounters.bind(null, dealId, proposed.id)}>
              <Button size="sm" type="submit">
                Accept counters into v{(latest?.version ?? proposed.version) + 1}
              </Button>
            </form>
          ) : null}
        </div>
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
              <Button size="sm" type="submit" formAction={proposeTerms.bind(null, dealId, latest.id)}>
                Propose to seller (v{latest.version})
              </Button>
              <Button size="sm" variant="outline" type="submit">
                Save notes
              </Button>
            </div>
          ) : null}
        </form>
      ) : writer && view.active && !agreed ? (
        <form action={draftTerms.bind(null, dealId)}>
          <Button size="sm" variant="outline" type="submit">
            Draft terms from the active pricing
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function Brief({ dealId, view, writer, titles, outcome, aiEnabled }: { dealId: string; view: PricingView; writer: boolean; titles: ReadonlyMap<string, string>; outcome: string | undefined; aiEnabled: boolean }) {
  if (!view.active) return null;
  return (
    <section id="pricing-brief" className="flex scroll-mt-24 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-bold">Negotiation brief</h3>
        <AiBadge>AI draft · buyer-only</AiBadge>
        {writer ? (
          <form action={draftBrief.bind(null, dealId, view.active.evaluationId)}>
            <Button size="sm" variant="outline" type="submit" disabled={!aiEnabled} title={aiEnabled ? undefined : 'AI is off in this environment'}>
              {view.brief ? 'Redraft' : 'Draft brief'}
            </Button>
          </form>
        ) : null}
      </div>
      <Notice outcome={outcome} section="brief" />
      {!aiEnabled ? <p className="text-sm text-muted-foreground">AI is off in this environment, so the brief can’t be drafted here. Everything else on this page works.</p> : null}
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
      ) : aiEnabled ? (
        <p className="text-sm text-muted-foreground">A short framing of the active terms in this persona’s tone, every point citing an accepted finding. Amounts stay in the table above.</p>
      ) : null}
    </section>
  );
}

/**
 * Buyer personas (T-105): price the same accepted findings through another
 * lens in one action, compare against the active pricing, adopt one, propose
 * versioned terms, see the seller's answers, and draft the brief. Buyer-only.
 */
export async function PricingPanel({ dealId, viewer, outcome }: { dealId: string; viewer: DealViewer; outcome: string | undefined }) {
  const [result, accepted, ai] = await Promise.all([
    apiGet<PricingView>(`/v1/deals/${encodeURIComponent(dealId)}/pricing`),
    apiGet<{ items: { id: string; title: string }[] }>(`/v1/deals/${encodeURIComponent(dealId)}/findings?status=ACCEPTED`),
    apiGet<{ enabled: boolean }>('/v1/ai/status'),
  ]);
  if (result.kind !== 'ok') return null;
  const view = result.data;
  const writer = can.draft(viewer.role);
  const titles = new Map((accepted.kind === 'ok' ? accepted.data.items : []).map((finding) => [finding.id, finding.title]));
  const label = (persona: string) => view.persona.options.find((option) => option.persona === persona)?.label ?? persona;
  const active = view.evaluations.find((evaluation) => evaluation.id === view.active?.evaluationId);

  return (
    <Card id="pricing" className="scroll-mt-24">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle className="mr-auto">Priced as: {active ? active.personaLabel : label(view.persona.effective)}</CardTitle>
        <Badge variant="neutral">buyer-only</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        <p className="text-muted-foreground">
          The same accepted findings, priced through a buyer’s deal-making style. Evaluating under another persona adds a new run; findings and earlier runs never change, and nothing reaches the seller until you propose terms.
        </p>
        <Notice outcome={outcome} section="evaluate" />
        {writer ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-3">
              {view.persona.options.map((option) => (
                <form key={option.persona} action={evaluateAs.bind(null, dealId)} className="h-full">
                  <input type="hidden" name="persona" value={option.persona} />
                  <PersonaCard
                    option={option}
                    selected={option.persona === view.persona.effective}
                    control={option.persona === view.persona.effective ? <Badge variant="neutral">this pact</Badge> : undefined}
                    footer={
                      <Button size="sm" variant={option.persona === view.persona.effective ? 'default' : 'outline'} type="submit">
                        Evaluate as {option.label}
                      </Button>
                    }
                  />
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
              <Button size="sm" variant="outline" type="submit">
                Save
              </Button>
            </form>
          </div>
        ) : null}

        <Compare dealId={dealId} view={view} writer={writer} />
        <Terms dealId={dealId} view={view} writer={writer} titles={titles} outcome={outcome} />
        <Brief dealId={dealId} view={view} writer={writer} titles={titles} outcome={outcome} aiEnabled={ai.kind === 'ok' ? ai.data.enabled : false} />
      </CardContent>
    </Card>
  );
}
