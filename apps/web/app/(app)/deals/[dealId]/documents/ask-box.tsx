'use client';

import { Badge, Button } from '@pactlab/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { askQuestion, type AskState } from './actions';

/** Ask across the deal's documents. Answers carry citations; unsupported claims are withheld. */
export function AskBox({ dealId }: { dealId: string }) {
  const [state, action, pending] = useActionState<AskState, FormData>(askQuestion.bind(null, dealId), { kind: 'idle' });
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
            <p className="text-muted-foreground">No cited answer found in the documents.</p>
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
          <p className="text-xs text-muted-foreground">
            AI-generated, requires human review · {state.model}
            {state.withheld > 0 ? ` · ${state.withheld} unsupported statement(s) withheld` : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
