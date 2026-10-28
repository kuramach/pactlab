import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Glossed } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { can, dealViewer } from '../../_lib/viewer';
import { extractDocument } from './actions';
import { DocumentLibrary } from './library';
import { ReviewQueue } from './review-queue';
import { DocumentUploader } from './uploader';
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
  const documentName = (id: string) => (documents.kind === 'ok' ? (documents.data.items.find((doc) => doc.id === id)?.fileName ?? 'another document') : 'another document');

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
            <CardTitle className="text-base">Upload documents</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentUploader dealId={dealId} aiOn={aiOn} />
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
        <DocumentLibrary
          dealId={dealId}
          openId={view.documentId}
          aiOn={aiOn}
          writer={writer}
          rows={documents.data.items.map((doc) => ({
            ...doc,
            findings: queue.filter((finding) => finding.documentId === doc.id).length,
            pending: queue.filter((finding) => finding.documentId === doc.id && finding.status === 'DRAFT').length,
          }))}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {page?.kind === 'ok'
                ? page.data.fileName
                : 'Document'}
            </CardTitle>
            {page?.kind === 'ok' && writer ? (
              <form action={extractDocument.bind(null, dealId, page.data.documentId)}>
                <Button type="submit" size="sm" variant="outline">
                  Re-run AI extraction
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
                <PagePager dealId={dealId} documentId={page.data.documentId} pageNumber={page.data.pageNumber} pageCount={page.data.pageCount} />
                {citedPages.length > 0 ? (
                  <nav aria-label="Cited quotes" className="mb-3 flex items-center justify-between gap-2 text-sm">
                    {previousCited ? (
                      <Link href={citationHref(dealId, previousCited)} className="hover:underline">
                        ← Previous quoted page{previousCited.documentId !== view.documentId ? ` (${documentName(previousCited.documentId)} p. ${previousCited.pageNumber})` : ` (p. ${previousCited.pageNumber})`}
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {citedAt === -1
                        ? `${citedPages.length} page${citedPages.length === 1 ? '' : 's'} with quotes in the review queue — none on this page`
                        : `Quoted page ${citedAt + 1} of ${citedPages.length} in the review queue · ${quotesOnPage.length} quote${quotesOnPage.length === 1 ? '' : 's'} highlighted here`}
                    </span>
                    {nextCited ? (
                      <Link href={citationHref(dealId, nextCited)} className="hover:underline">
                        Next quoted page{nextCited.documentId !== view.documentId ? ` (${documentName(nextCited.documentId)} p. ${nextCited.pageNumber})` : ` (p. ${nextCited.pageNumber})`} →
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
                <div className="mt-4">
                  <PagePager dealId={dealId} documentId={page.data.documentId} pageNumber={page.data.pageNumber} pageCount={page.data.pageCount} />
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
                description="Upload documents above. With AI on, extraction starts on its own and drafts appear here."
              />
            ) : (
              <ReviewQueue dealId={dealId} findings={queue} reviewer={reviewer} reviewerName={viewer.name(viewer.userId)} openPage={view.documentId ? { documentId: view.documentId, pageNumber: view.page } : null} />
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

/** One page concept: "Page X of N" for the open document, with previous and next. */
function PagePager({ dealId, documentId, pageNumber, pageCount }: { dealId: string; documentId: string; pageNumber: number; pageCount: number }) {
  return (
    <nav aria-label="Pages" className="mb-3 flex items-center justify-between gap-2 text-sm">
      {pageNumber > 1 ? (
        <Link href={citationHref(dealId, { documentId, pageNumber: pageNumber - 1 })} scroll={false} className="hover:underline">
          ← Previous page
        </Link>
      ) : (
        <span />
      )}
      <span className="font-medium">
        Page {pageNumber} of {pageCount}
      </span>
      {pageNumber < pageCount ? (
        <Link href={citationHref(dealId, { documentId, pageNumber: pageNumber + 1 })} scroll={false} className="hover:underline">
          Next page →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
