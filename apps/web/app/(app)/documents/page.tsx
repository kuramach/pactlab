import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../deals/_lib/api';
import { ApiState } from '../deals/_lib/states';
import {
  citationHref,
  highlightQuotes,
  parseDocumentsView,
  reviewQueueOrder,
  type DocumentFindingItem,
  type DocumentListItem,
  type DocumentPageView,
} from './_lib/view';

const deal = (dealId: string) => `/v1/deals/${encodeURIComponent(dealId)}`;

/**
 * Document review: page on the left, AI drafts and decisions on the right.
 * Every draft shows its model label and prompt version; citation chips open
 * the exact page. Decisions are made through the review API by a named human.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const view = parseDocumentsView(await searchParams);
  if (!view.dealId) {
    return (
      <div className="flex max-w-6xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <EmptyState
          title="Choose a deal"
          description="Open documents from a deal to review pages, answers and AI drafts."
        />
      </div>
    );
  }
  const dealId = view.dealId;
  const [documents, findings, page] = await Promise.all([
    apiGet<{ items: DocumentListItem[] }>(`${deal(dealId)}/documents`),
    apiGet<{ items: DocumentFindingItem[] }>(`${deal(dealId)}/document-findings`),
    view.documentId
      ? apiGet<DocumentPageView>(
          `${deal(dealId)}/documents/${encodeURIComponent(view.documentId)}/pages/${view.page}`,
        )
      : Promise.resolve(null),
  ]);
  const queue = findings.kind === 'ok' ? reviewQueueOrder(findings.data.items) : [];
  const quotesOnPage = queue.flatMap((finding) =>
    finding.citations
      .filter((c) => c.documentId === view.documentId && c.pageNumber === view.page)
      .map((c) => c.quote),
  );

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/deals" className="text-sm text-muted-foreground hover:underline">
          ← Deals
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Data-room documents as cited evidence. AI drafts stay drafts until a named reviewer
          decides.
        </p>
      </header>

      {documents.kind !== 'ok' ? (
        <ApiState result={documents} />
      ) : documents.data.items.length === 0 ? (
        <EmptyState
          title="No documents"
          description="Upload a contract or data-room file to this deal to start."
        />
      ) : (
        <nav aria-label="Documents" className="flex flex-wrap gap-2 text-sm">
          {documents.data.items.map((doc) => (
            <Link
              key={doc.id}
              href={citationHref(dealId, { documentId: doc.id, pageNumber: 1 })}
              className={`rounded-md border border-border px-3 py-1 ${doc.id === view.documentId ? 'bg-muted font-medium' : ''}`}
            >
              {doc.fileName}
              <span className="ml-2 text-muted-foreground">
                {doc.status === 'PURGED' ? 'purged' : `${doc.pageCount} pp`}
                {doc.aiExcluded ? ' · AI excluded' : ''}
              </span>
            </Link>
          ))}
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {page?.kind === 'ok'
                ? `${page.data.fileName} — page ${page.data.pageNumber} of ${page.data.pageCount}`
                : 'Page'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {page === null ? (
              <EmptyState
                title="No page open"
                description="Select a document or a citation chip."
              />
            ) : page.kind !== 'ok' ? (
              <ApiState result={page} />
            ) : !page.data.available || page.data.text === null ? (
              <EmptyState
                title="Source unavailable"
                description="This document was purged under its retention policy. Hashes and decisions are preserved."
              />
            ) : (
              <>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {highlightQuotes(page.data.text, quotesOnPage).map((part, index) =>
                    part.cited ? (
                      <mark key={index} className="rounded bg-sky-100 px-0.5">
                        {part.text}
                      </mark>
                    ) : (
                      <span key={index}>{part.text}</span>
                    ),
                  )}
                </pre>
                <div className="mt-4 flex justify-between text-sm">
                  {page.data.pageNumber > 1 ? (
                    <Link
                      href={citationHref(dealId, {
                        documentId: page.data.documentId,
                        pageNumber: page.data.pageNumber - 1,
                      })}
                      className="hover:underline"
                    >
                      ← Previous page
                    </Link>
                  ) : (
                    <span />
                  )}
                  {page.data.pageNumber < page.data.pageCount ? (
                    <Link
                      href={citationHref(dealId, {
                        documentId: page.data.documentId,
                        pageNumber: page.data.pageNumber + 1,
                      })}
                      className="hover:underline"
                    >
                      Next page →
                    </Link>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review queue</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {findings.kind !== 'ok' ? (
              <ApiState result={findings} />
            ) : queue.length === 0 ? (
              <EmptyState
                title="Nothing to review"
                description="Run contract extraction on a document to create draft findings."
              />
            ) : (
              queue.map((finding) => (
                <article
                  key={finding.id}
                  className="flex flex-col gap-2 border-b border-border pb-4 last:border-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        finding.status === 'DRAFT'
                          ? 'draft'
                          : finding.status === 'ACCEPTED'
                            ? 'reviewed'
                            : 'neutral'
                      }
                    >
                      {finding.status === 'DRAFT'
                        ? 'AI draft'
                        : finding.status === 'ACCEPTED'
                          ? 'Accepted'
                          : 'Rejected'}
                    </Badge>
                    <Badge
                      variant={
                        finding.severity === 'HIGH' || finding.severity === 'CRITICAL'
                          ? 'danger'
                          : 'neutral'
                      }
                    >
                      {finding.severity}
                    </Badge>
                    <h2 className="font-medium">{finding.title}</h2>
                  </div>
                  <p className="text-sm">{finding.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    {finding.citations.map((citation) => (
                      <Link key={citation.citationId} href={citationHref(dealId, citation)}>
                        <Badge variant="evidence">p. {citation.pageNumber}</Badge>
                      </Link>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Model-generated · {finding.provenance.promptId} v
                    {finding.provenance.promptVersion} · {finding.provenance.resolvedModelId}
                    {finding.reviewer
                      ? ` · decided by ${finding.reviewer.displayName}`
                      : ' · awaiting human review'}
                  </p>
                </article>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
