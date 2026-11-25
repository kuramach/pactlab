'use client';

import { AiBadge, Badge, Button } from '@pactlab/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { citationHref } from '../../../documents/_lib/view';
import { extractWithGuidance, importDocument, understandOne, type CitedQuote, type DocumentUnderstandingView, type DraftView, type GuidedExtractResult } from './actions';

const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const humanize = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');
const KIND_LABELS: Record<string, string> = { PARTIES: 'Parties', KEY_DATES: 'Key dates' };
const GROUP_LABELS: Record<string, string> = { PARTY: 'Parties', DATE: 'Dates', CLAUSE: 'Clauses', CONSISTENCY: 'Drafting problems' };
const GROUP_ORDER = ['PARTY', 'DATE', 'CLAUSE', 'CONSISTENCY'];

/** The person's answers, as the guidance the extraction reads: each question with its answer, then anything else. */
export function guidanceFrom(questions: readonly string[], answers: readonly string[], more: string): string {
  const lines = questions.flatMap((question, index) => {
    const answer = (answers[index] ?? '').trim();
    return answer ? [`Q: ${question}`, `A: ${answer}`] : [];
  });
  if (more.trim()) lines.push(`Also: ${more.trim()}`);
  return lines.join('\n').slice(0, 2000);
}

/** Drafts grouped as a person reads them: parties, dates, clauses, drafting problems. */
export function groupDrafts(drafts: readonly DraftView[]): { kind: string; label: string; drafts: DraftView[] }[] {
  return GROUP_ORDER.flatMap((kind) => {
    const inGroup = drafts.filter((draft) => draft.kind === kind);
    return inGroup.length > 0 ? [{ kind, label: GROUP_LABELS[kind] ?? humanize(kind), drafts: inGroup }] : [];
  });
}

function PageLink({ dealId, citation }: { dealId: string; citation: CitedQuote | undefined }) {
  if (!citation) return null;
  return (
    <Link href={citationHref(dealId, citation)} className="whitespace-nowrap text-xs text-muted-foreground underline">
      p. {citation.pageNumber}
    </Link>
  );
}

/**
 * A spreadsheet in the data room is imported as data, so its numbers feed the metrics (Kumar, 2026-11-25), never
 * read as a contract. Without a target to import it as, the person is told what to do instead.
 */
export function ReadSpreadsheet({ dealId, documentId, target }: { dealId: string; documentId: string; target: string | null }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  if (!target) {
    return <p className="text-xs text-muted-foreground">This is a spreadsheet. Sort it with AI (or say what it is) in the library to import it as data; or ask a question about it below.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await importDocument(dealId, documentId, target);
              setMessage(result.message);
            })
          }
        >
          {pending ? 'Reading…' : 'Read this spreadsheet'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Pactlab reads its columns and rows, asks what it needs, then imports it so its numbers feed the metrics.</p>
      {message ? (
        <p role="alert" className="text-xs text-red-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * AI extraction that talks first (Kumar, 2026-11-25): read the document and say how it is set up, what will be
 * drafted and what Pactlab needs to know; take the answers; extract; then show what was picked up and where it goes.
 * Drafts stay drafts until a person accepts them.
 */
export function ExtractionAssistant({ dealId, documentId }: { dealId: string; documentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [understanding, setUnderstanding] = useState<DocumentUnderstandingView | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [more, setMore] = useState('');
  const [result, setResult] = useState<Extract<GuidedExtractResult, { kind: 'ok' }> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const read = () =>
    start(async () => {
      setMessage(null);
      setResult(null);
      const outcome = await understandOne(dealId, documentId);
      if (outcome.kind === 'ok') {
        setUnderstanding(outcome.understanding);
        setAnswers(outcome.understanding.questions.map(() => ''));
      } else setMessage(outcome.message);
    });
  const extract = () =>
    start(async () => {
      setMessage(null);
      const guidance = understanding ? guidanceFrom(understanding.questions.map((entry) => entry.question), answers, more) : more;
      const outcome = await extractWithGuidance(dealId, documentId, guidance);
      if (outcome.kind === 'ok') {
        setResult(outcome);
        router.refresh();
      } else setMessage(outcome.message);
    });

  if (result) {
    const groups = groupDrafts(result.drafts);
    const priced = result.drafts.filter((draft) => draft.kind === 'CLAUSE' && (draft.severity === 'HIGH' || draft.severity === 'CRITICAL'));
    return (
      <section aria-labelledby="doc-picked-up" className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-3 text-sm">
        <h3 id="doc-picked-up" className="font-semibold">
          What Pactlab picked up
        </h3>
        <p role="status">
          {result.drafted === 0 ? 'No new drafts.' : `${result.drafted} new draft${result.drafted === 1 ? '' : 's'}, each quoting its page.`}
          {result.duplicates > 0 ? ` ${result.duplicates} already drafted before.` : ''}
        </p>
        {groups.map((group) => (
          <div key={group.kind} className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</span>
            <ul className="flex flex-col gap-1.5">
              {group.drafts.map((draft) => (
                <li key={draft.id} className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-2 py-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{draft.title}</span>
                    {draft.kind === 'CLAUSE' ? <Badge variant={draft.severity === 'HIGH' || draft.severity === 'CRITICAL' ? 'danger' : 'neutral'}>{humanize(draft.severity)}</Badge> : null}
                    <PageLink dealId={dealId} citation={draft.citations[0]} />
                  </span>
                  {draft.citations[0] ? <q className="text-xs text-muted-foreground">{draft.citations[0].quote}</q> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {priced.length > 0 ? (
          <p>
            {priced.length === 1 ? '1 clause matters' : `${priced.length} clauses matter`} for value. Once a reviewer accepts {priced.length === 1 ? 'it' : 'them'}, price {priced.length === 1 ? 'it' : 'them'} in the{' '}
            <Link href={`/deals/${dealId}/valuation`} className="underline">
              valuation
            </Link>
            .
          </p>
        ) : null}
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Where it shows</span>
          <ul className="list-disc pl-5">
            <li>The review queue on this page: a reviewer accepts or rejects each draft.</li>
            <li>
              <Link href={`/deals/${dealId}/findings`} className="underline">
                Findings
              </Link>
              : accepted drafts, with their pages.
            </li>
          </ul>
        </div>
        <div>
          <Button size="sm" variant="outline" onClick={() => setResult(null)} disabled={pending}>
            Run again with more guidance
          </Button>
        </div>
      </section>
    );
  }

  if (understanding) {
    return (
      <section aria-labelledby="doc-reading" className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-3 text-sm">
        <h3 id="doc-reading" className="flex flex-wrap items-center gap-2 font-semibold">
          Here’s how Pactlab read this document <Badge>{understanding.documentType}</Badge>
        </h3>
        <figure className="flex flex-col gap-1 rounded-md bg-background px-3 py-2">
          <figcaption className="flex items-center gap-1 text-xs text-muted-foreground">
            <AiBadge /> In the AI’s words
          </figcaption>
          <blockquote>{understanding.summary}</blockquote>
        </figure>
        {understanding.sections.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium">How it is set up</span>
            <ol className="flex list-decimal flex-col gap-0.5 pl-5">
              {understanding.sections.map((section, index) => (
                <li key={`${section.title}-${index}`}>
                  {section.title} <PageLink dealId={dealId} citation={section.citations[0]} />
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {understanding.willExtract.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium">What Pactlab will draft from it</span>
            <ul className="flex flex-wrap gap-1.5">
              {understanding.willExtract.map((entry, index) => (
                <li key={`${entry.kind}-${index}`} title={entry.note || undefined} className="flex items-center gap-1 rounded-full bg-background px-2.5 py-0.5 text-xs ring-1 ring-border">
                  {KIND_LABELS[entry.kind] ?? humanize(entry.kind)} <PageLink dealId={dealId} citation={entry.citations[0]} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {understanding.questions.length > 0 ? (
          <fieldset className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <legend className="px-1 font-medium text-amber-950">Pactlab needs you</legend>
            {understanding.questions.map((entry, index) => (
              <label key={entry.question} className="flex flex-col gap-1">
                <span>
                  {entry.question} <PageLink dealId={dealId} citation={entry.citations[0]} />
                </span>
                <textarea
                  rows={2}
                  maxLength={500}
                  className={inputClass}
                  value={answers[index] ?? ''}
                  onChange={(event) => setAnswers((current) => current.map((answer, at) => (at === index ? event.target.value : answer)))}
                  placeholder="Your answer, in your own words (optional)"
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="flex flex-col gap-1 font-medium">
          Tell Pactlab more (optional)
          <textarea rows={2} maxLength={800} className={inputClass} value={more} onChange={(event) => setMore(event.target.value)} placeholder="For example: Northwind is the company being bought" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={extract} disabled={pending}>
            {pending ? 'Extracting…' : 'Looks right, extract'}
          </Button>
          <span className="text-xs text-muted-foreground">Your answers guide the reading only; every draft still quotes its page.</span>
        </div>
        {message ? (
          <p role="alert" className="text-red-700">
            {message}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={read} disabled={pending}>
          {pending ? 'Reading…' : 'Read with AI'}
        </Button>
        <Button size="sm" variant="outline" onClick={extract} disabled={pending}>
          Extract straight away
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Pactlab reads it first, says how it is set up and asks what it needs, before drafting anything.</p>
      {message ? (
        <p role="alert" className="text-xs text-red-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}
