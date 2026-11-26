'use client';

import { Badge, Button } from '@pactlab/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { askQuestion, type AskCoverage, type AskState } from './actions';

/** One page of the library: what a question can be narrowed to. */
export interface AskChoice {
  readonly id: string;
  readonly fileName: string;
}

/** Ask across the deal's documents. Answers carry citations and say what was searched; unsupported claims are withheld. */
export function AskBox({ dealId, choices = [] }: { dealId: string; choices?: readonly AskChoice[] }) {
  const [state, action, pending] = useActionState<AskState, FormData>(askQuestion.bind(null, dealId), { kind: 'idle' });
  const answered = state.kind === 'answer' && state.claims.length > 0;
  // Over a partial read, an unanswered question may be in pages that were not read: offer to narrow it.
  const narrowing = state.kind === 'answer' && !answered && state.coverage?.partial === true ? state.coverage : null;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <input
          name="question"
          placeholder="e.g. Can any customer terminate on a change of control?"
          className="w-full rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Asking…' : 'Ask'}
        </Button>
      </form>
      {state.kind === 'error' ? <p className="text-amber-900">{state.message}</p> : null}
      {state.kind === 'answer' ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <p className="font-medium">{state.question}</p>
          {state.claims.length === 0 ? (
            <p className="text-muted-foreground">
              {state.coverage?.partial
                ? 'No cited answer in the pages read. That does not mean it is not in the data room: only the most relevant pages were read.'
                : 'No cited answer found in the documents.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {state.claims.map((claim, index) => (
                <li key={index} className="flex flex-col gap-1">
                  <span>{claim.statement}</span>
                  <span className="flex flex-wrap gap-1">
                    {claim.citations.map((citation, position) => (
                      <Link
                        key={position}
                        href={`/deals/${dealId}/documents?documentId=${citation.documentId}&page=${citation.pageNumber}`}
                      >
                        <Badge variant="evidence">
                          {citation.documentName ?? 'document'} p. {citation.pageNumber}
                        </Badge>
                      </Link>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {state.coverage ? <CoverageNote coverage={state.coverage} /> : null}
          {narrowing ? <NarrowForm action={action} pending={pending} question={state.question} coverage={narrowing} choices={choices} /> : null}
          <p className="text-xs text-muted-foreground">
            {state.model ? `AI-generated, requires human review · ${state.model}` : 'No pages matched, so nothing was sent to the AI'}
            {state.withheld > 0 ? ` · ${state.withheld} unsupported statement(s) withheld` : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** What was searched and which pages were read. */
export function CoverageNote({ coverage }: { coverage: AskCoverage }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-xs">
      <span className="font-medium">{coverage.summary}</span>
      {coverage.partial && coverage.documents.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {coverage.documents.map((document) => (
            <li key={document.documentId}>
              {document.documentName}: p. {document.pageNumbers.join(', ')}
            </li>
          ))}
          {coverage.moreDocuments > 0 ? <li>and pages of {coverage.moreDocuments} more documents</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Ask the same question of chosen documents, which can then be read whole. */
export function NarrowForm({
  action,
  pending,
  question,
  coverage,
  choices,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  question: string;
  coverage: AskCoverage;
  choices: readonly AskChoice[];
}) {
  const options = new Map<string, string>(coverage.documents.map((document) => [document.documentId, document.documentName]));
  for (const choice of choices) if (!options.has(choice.id)) options.set(choice.id, choice.fileName);
  if (options.size === 0) return null;
  return (
    <form action={action} className="flex flex-col gap-2 border-t border-border pt-3">
      <input type="hidden" name="question" value={question} />
      <span className="font-medium">Narrow the question to chosen documents</span>
      <div className="flex flex-col gap-1">
        {[...options].map(([id, name]) => (
          <label key={id} className="flex items-center gap-2">
            <input type="checkbox" name="documentId" value={id} /> {name}
          </label>
        ))}
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Asking…' : 'Ask these documents'}
        </Button>
      </div>
    </form>
  );
}
