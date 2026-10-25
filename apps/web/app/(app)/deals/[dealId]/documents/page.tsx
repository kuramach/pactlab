import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, FileDrop, Glossed } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { can, dealViewer } from '../../_lib/viewer';
import { extractDocument, reviewDocumentFinding, uploadDocument } from './actions';
import { AI_UNAVAILABLE } from './ai-messages';
import { AskBox } from './ask-box';
import { PdfPageView } from './pdf-page-view';
import {
  citationHref,
  highlightQuotes,
  parseDocumentsView,
  reviewQueueOrder,
  type DocumentFindingItem,
  type DocumentListItem,
  type DocumentPageView,
} from '../../../documents/_lib/view';

const deal = (dealId: string) => `/v1/deals/${encodeURIComponent(dealId)}`;

interface AiStatus {
  enabled: boolean;
  provider: string;
  region: string | null;
  routes: { alias: string; modelId: string; label: string }[];
}

const OUTCOMES: Record<string, string> = {
  'ok-uploaded': 'Document uploaded, scanned and split into pages.',
  'ok-accept': 'Draft accepted — its citations were re-checked against the page.',
  'ok-reject': 'Draft rejected.',
  'no-file': 'Choose a file to upload.',
  type: 'Upload a PDF, Word (.docx), Excel (.xlsx), CSV, text or Markdown file. Older .xls workbooks: save as .xlsx first.',
  'too-large': 'PDF, Word and Excel files can be up to 10 MB; CSV, text and Markdown up to 512 KB.',
  rejected:
    'The file was rejected — it may be empty, unreadable, password-protected, a scanned PDF with no text (OCR is not available yet) or flagged by the virus scan.',
  unavailable: 'Uploads are not available in this environment.',
  'ai-off': 'AI is not switched on for this environment yet. Drafts will appear once the Claude connection is enabled.',
  'ai-excluded': 'This document is excluded from AI, or holds data that may never be sent to a model.',
  rationale: 'Write a short rationale (a few words) for the decision.',
};

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Document review: page on the left, AI drafts and decisions on the right.
 * Every draft shows its model label and prompt version; citation chips open
 * the exact page. Decisions are made through the review API by a named human.
 */
export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const view = parseDocumentsView({ ...(await searchParams), dealId: (await params).dealId });
  if (!view.dealId) {
    return (
      <div className="flex max-w-6xl flex-col gap-6">
        <EmptyState
          title="Choose a deal"
          description="Open documents from a deal to review pages, answers and AI drafts."
        />
      </div>
    );
  }
  const dealId = view.dealId;
  const outcomeParam = (await searchParams)['outcome'];
  const outcome = typeof outcomeParam === 'string' ? outcomeParam : undefined;
  const drafted = outcome?.match(/^ok-drafted-(\d+)$/)?.[1];
  const [documents, findings, page, viewer, ai] = await Promise.all([
    apiGet<{ items: DocumentListItem[] }>(`${deal(dealId)}/documents`),
    apiGet<{ items: DocumentFindingItem[] }>(`${deal(dealId)}/document-findings`),
    view.documentId
      ? apiGet<DocumentPageView>(
          `${deal(dealId)}/documents/${encodeURIComponent(view.documentId)}/pages/${view.page}`,
        )
      : Promise.resolve(null),
    dealViewer(dealId),
    apiGet<AiStatus>('/v1/ai/status'),
  ]);
  const aiOn = ai.kind === 'ok' && ai.data.enabled;
  const balanced = ai.kind === 'ok' ? ai.data.routes.find((route) => route.alias === 'balanced') : undefined;
  const writer = can.draft(viewer.role);
  const reviewer = can.review(viewer.role);
  const queue = findings.kind === 'ok' ? reviewQueueOrder(findings.data.items) : [];
  const quotesOnPage = queue.flatMap((finding) =>
    finding.citations
      .filter((c) => c.documentId === view.documentId && c.pageNumber === view.page)
      .map((c) => c.quote),
  );
  const openDocument = documents.kind === 'ok' ? documents.data.items.find((doc) => doc.id === view.documentId) : undefined;
  const isPdf = openDocument?.contentType === 'application/pdf' && openDocument.status === 'AVAILABLE';
  // Every cited page in review order, to step through the queue's quotes beside the original.
  const citedPages = [...new Map(queue.flatMap((finding) => finding.citations.map((c) => [`${c.documentId}:${c.pageNumber}`, c] as const))).values()];
  const citedAt = citedPages.findIndex((c) => c.documentId === view.documentId && c.pageNumber === view.page);
  const previousCited = citedAt > 0 ? citedPages[citedAt - 1] : undefined;
  const nextCited = citedAt === -1 ? citedPages[0] : citedPages[citedAt + 1];

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Documents</h2>
        <p className="text-sm text-muted-foreground">
          <Glossed text="Uploaded documents, cited answers and AI drafts. Every citation opens the exact page." />
        </p>
        <div className="mt-1">
          {aiOn ? (
            <Badge variant="calculation" title={balanced?.modelId}>
              AI on — {balanced?.label ?? 'Claude'} via Amazon Bedrock{ai.kind === 'ok' && ai.data.region ? ` (${ai.data.region})` : ''}
            </Badge>
          ) : (
            <Badge variant="neutral">AI off — uploads, pages and citations still work; drafts and answers need the Claude connection</Badge>
          )}
        </div>
      </div>

      <OutcomeBanner
        outcome={drafted !== undefined ? 'ok-drafted' : outcome}
        messages={{
          ...OUTCOMES,
          // With AI configured, an unknown failure is a failed call, not "AI is off".
          ...(aiOn ? { 'ai-off': AI_UNAVAILABLE['ai-failed'] } : {}),
          'ai-access': AI_UNAVAILABLE['ai-access'],
          'ai-throttled': AI_UNAVAILABLE['ai-throttled'],
          'ai-failed': AI_UNAVAILABLE['ai-failed'],
          'ok-drafted': `AI extraction finished: ${drafted ?? 0} new cited draft(s) in the review queue.` }}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload a document</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={uploadDocument.bind(null, dealId)} className="flex flex-col gap-3 text-sm">
              <FileDrop
                name="file"
                accept=".pdf,.docx,.xlsx,.csv,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,text/markdown"
                required
                formats={['PDF', 'Word', 'Excel', 'CSV', 'Text', 'Markdown']}
                hint="PDF, Word and Excel up to 10 MB; CSV and text up to 512 KB"
              />
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  Contains
                  <select name="dataClass" className="rounded-md border border-border bg-background px-2 py-1">
                    <option value="BUSINESS">business information</option>
                    <option value="FINANCIAL">financial information</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="aiExcluded" /> Keep away from <Glossed text="AI" />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                <Glossed text="PDF, Word or Excel up to 10 MB; CSV, text or Markdown up to 512 KB. Word documents are split into sections and each Excel sheet starts a new page. HR, pay and performance documents are never sent to a model." />
              </p>
              <div>
                <Button type="submit" size="sm">
                  Upload
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ask the documents</CardTitle>
          </CardHeader>
          <CardContent>
            <AskBox dealId={dealId} />
          </CardContent>
        </Card>
      </div>

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
              <Glossed text={doc.fileName} />
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
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {page?.kind === 'ok'
                ? `${page.data.fileName} — page ${page.data.pageNumber} of ${page.data.pageCount}`
                : 'Page'}
            </CardTitle>
            {page?.kind === 'ok' && writer ? (
              <form action={extractDocument.bind(null, dealId, page.data.documentId)}>
                <Button type="submit" size="sm" variant="outline">
                  Run AI extraction
                </Button>
              </form>
            ) : null}
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
                {citedPages.length > 0 ? (
                  <nav aria-label="Cited quotes" className="mb-3 flex items-center justify-between gap-2 text-sm">
                    {previousCited ? (
                      <Link href={citationHref(dealId, previousCited)} className="hover:underline">
                        ← Previous quote
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {citedAt === -1 ? `${citedPages.length} cited pages in the review queue` : `Cited page ${citedAt + 1} of ${citedPages.length}`}
                    </span>
                    {nextCited ? (
                      <Link href={citationHref(dealId, nextCited)} className="hover:underline">
                        Next quote →
                      </Link>
                    ) : (
                      <span />
                    )}
                  </nav>
                ) : null}
                {isPdf ? (
                  <PdfPageView
                    src={`/deals/${dealId}/documents/${page.data.documentId}/original`}
                    pageNumber={page.data.pageNumber}
                    quotes={quotesOnPage}
                    fileName={page.data.fileName}
                  />
                ) : null}
                {isPdf ? (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-indigo-ink">Extracted text (what citations are checked against)</summary>
                    <ExtractedText text={page.data.text} quotes={quotesOnPage} />
                  </details>
                ) : (
                  <ExtractedText text={page.data.text} quotes={quotesOnPage} />
                )}
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
                    {finding.reviewer ? null : ' · awaiting human review'}
                  </p>
                  {finding.reviewer ? (
                    <p className="rounded-lg border border-navy/10 bg-mist px-3 py-2 text-xs">
                      <span className="font-semibold">
                        {finding.status === 'ACCEPTED' ? 'Accepted' : finding.status === 'REJECTED' ? 'Rejected' : 'Decided'} by {finding.reviewer.displayName}
                        {finding.decidedAt ? ` on ${finding.decidedAt.slice(0, 10)}` : ''}
                      </span>
                      {finding.decisionRationale ? <>: “{finding.decisionRationale}”</> : null}
                    </p>
                  ) : null}
                  {finding.status === 'DRAFT' && reviewer ? (
                    <form
                      action={reviewDocumentFinding.bind(null, dealId, finding.id, finding.documentId)}
                      className="flex flex-col gap-2"
                    >
                      <input type="hidden" name="expectedVersion" value={finding.version} />
                      <label className="flex flex-col gap-1 text-xs font-semibold">
                        Reason for your decision <span className="font-normal text-muted-foreground">Required · saved in the audit trail with your name</span>
                        <textarea
                          name="rationale"
                          required
                          minLength={3}
                          rows={2}
                          placeholder="Accepting: what did you confirm in the document? e.g. “Clause 14 on p. 2 matches; termination needs 30 days’ notice.” Rejecting: why is it wrong or not relevant? e.g. “Clause was deleted in the 2025 amendment.”"
                          className={`${inputClass} font-normal`}
                        />
                      </label>
                      <div className="flex gap-2">
                        <Button type="submit" name="decision" value="ACCEPT" size="sm">
                          Accept
                        </Button>
                        <Button type="submit" name="decision" value="REJECT" size="sm" variant="outline">
                          Reject
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </article>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ExtractedText({ text, quotes }: { text: string; quotes: readonly string[] }) {
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
      {highlightQuotes(text, quotes).map((part, index) =>
        part.cited ? (
          <mark key={index} className="rounded bg-sky-100 px-0.5">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </pre>
  );
}
