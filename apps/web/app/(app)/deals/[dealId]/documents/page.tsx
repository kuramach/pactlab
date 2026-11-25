import { AiBadge, Card, CardContent, CardHeader, CardTitle, EmptyState, Glossed } from '@pactlab/ui';
import type { Page } from '@pactlab/contracts';
import Link from 'next/link';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../../_components/pager';
import { apiGet, dealsApi } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { can, dealViewer } from '../../_lib/viewer';
import { ExtractionAssistant, ReadSpreadsheet } from './extraction-assistant';
import { IntakePanel, type IntakeView } from './intake-panel';
import { RequestsCard, type DocumentRequestView } from './requests-card';
import { SourcesPanel, type SourcesView } from './sources-panel';
import { DocumentLibrary } from './library';
import { importTargetOf, TABLE_TYPES } from './spreadsheets';
import { libraryHref } from './library-href';
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
  const search = await searchParams;
  const view = parseDocumentsView({ ...search, dealId: (await params).dealId });
  // The library and the review queue page in the database (T-126), each with its own position in the URL.
  const library = libraryQuery(search);
  const docsAt = readPage(search, 'docs');
  const queueAt = readPage(search, 'queue');
  const decidedTab = search['queue'] === 'decided';
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
  const [documents, findings, page, viewer, ai, intake, sources, requests, pact] = await Promise.all([
    apiGet<Page<DocumentListItem & { findings: number; pending: number }>>(`${deal(dealId)}/documents?${[library.api, pageApiQuery(docsAt)].filter(Boolean).join('&')}`),
    apiGet<Page<DocumentFindingItem & { documentName: string }>>(`${deal(dealId)}/document-findings?decided=${decidedTab}${docsQuery(pageApiQuery(queueAt))}`),
    view.documentId
      ? apiGet<DocumentPageView>(
          `${deal(dealId)}/documents/${encodeURIComponent(view.documentId)}/pages/${view.page}`,
        )
      : Promise.resolve(null),
    dealViewer(dealId),
    apiGet<AiStatus>('/v1/ai/status'),
    apiGet<IntakeView>(`${deal(dealId)}/intake`),
    apiGet<SourcesView>(`${deal(dealId)}/document-sources`),
    apiGet<{ items: DocumentRequestView[] }>(`${deal(dealId)}/document-requests`),
    dealsApi.get(dealId),
  ]);
  // The open document, wherever it sits in the library's pages.
  const opened = view.documentId ? await apiGet<DocumentListItem>(`${deal(dealId)}/documents/${encodeURIComponent(view.documentId)}`) : null;
  const hasSeller = viewer.members.some((member) => member.role === 'TARGET_CONTRIBUTOR' && member.status === 'ACTIVE');
  const categoryLabels = intake.kind === 'ok' ? Object.fromEntries(intake.data.categories.map((category) => [category.id, category.label])) : {};
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
  const openDocument = opened?.kind === 'ok' ? opened.data : undefined;
  const isPdf = openDocument?.contentType === 'application/pdf' && openDocument.status === 'AVAILABLE';
  // Every cited page in review order, to step through the queue's quotes beside the original.
  const citedPages = [...new Map(queue.flatMap((finding) => finding.citations.map((c) => [`${c.documentId}:${c.pageNumber}`, c] as const))).values()];
  const citedAt = citedPages.findIndex((c) => c.documentId === view.documentId && c.pageNumber === view.page);
  const previousCited = citedAt > 0 ? citedPages[citedAt - 1] : undefined;
  const nextCited = citedAt === -1 ? citedPages[0] : citedPages[citedAt + 1];
  const names = new Map<string, string>(queue.flatMap((finding) => (finding.documentName ? [[finding.documentId, finding.documentName] as const] : [])));
  if (openDocument) names.set(openDocument.id, openDocument.fileName);
  const documentName = (id: string) => names.get(id) ?? 'another document';

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Documents</h2>
        <p className="text-sm text-muted-foreground">
          <Glossed text="Uploaded documents, cited answers and AI drafts. Every citation opens the exact page." />
        </p>
        <div className="mt-1">
          {aiOn ? (
            <AiBadge>
              <span title={balanced?.modelId}>
                AI on — {balanced?.label ?? 'Claude'} via Amazon Bedrock{ai.kind === 'ok' && ai.data.region ? ` (${ai.data.region})` : ''}
              </span>
            </AiBadge>
          ) : (
            <AiBadge className="border-border bg-muted text-muted-foreground">AI off — uploads, pages and citations still work; drafts and answers need the Claude connection</AiBadge>
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
          'ai-delayed': AI_UNAVAILABLE['ai-delayed'],
          'ai-failed': AI_UNAVAILABLE['ai-failed'],
          'ai-not-approved': AI_UNAVAILABLE['ai-not-approved'],
          'ok-drafted': `AI extraction finished: ${drafted ?? 0} new cited draft(s) in the review queue.` }}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{viewer.role === 'TARGET_CONTRIBUTOR' ? 'Share documents with the buyer' : 'Upload documents'}</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentUploader
              dealId={dealId}
              aiOn={aiOn}
              shareLabel={viewer.role === 'TARGET_CONTRIBUTOR' || viewer.role === 'BIDDER' ? null : pact.kind === 'ok' && pact.data.initiatedBy === 'SELLER' ? 'Share with bidders' : 'Share with the seller'}
            />
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

      {requests.kind === 'ok' && requests.data.items.some((request) => request.status === 'OPEN') ? (
        <Card>
          <CardContent className="pt-6">
            <RequestsCard dealId={dealId} requests={requests.data.items} buyer={writer && viewer.role !== 'TARGET_CONTRIBUTOR'} />
          </CardContent>
        </Card>
      ) : null}

      {sources.kind === 'ok' ? (
        <Card id="data-room">
          <CardHeader>
            <CardTitle className="text-base">{sources.data.seller ? 'Your drive folders' : 'Data room'}</CardTitle>
          </CardHeader>
          <CardContent>
            <SourcesPanel dealId={dealId} sources={sources.data} aiOn={aiOn} justConnected={typeof search['source'] === 'string' ? search['source'] : null} />
          </CardContent>
        </Card>
      ) : null}

      {intake.kind === 'ok' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Intake</CardTitle>
          </CardHeader>
          <CardContent>
            <IntakePanel dealId={dealId} intake={intake.data} writer={writer} aiOn={aiOn} hasSeller={hasSeller} />
          </CardContent>
        </Card>
      ) : null}

      {documents.kind !== 'ok' ? (
        <ApiState result={documents} />
      ) : documents.data.total === 0 && !library.filtered ? (
        <EmptyState
          title="No documents"
          description="Upload a contract or data-room file to this deal to start."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <DocumentLibrary
            dealId={dealId}
            openId={view.documentId}
            aiOn={aiOn}
            writer={writer}
            categoryLabels={categoryLabels}
            rows={documents.data.items}
            total={documents.data.total}
            filters={library.filters}
            params={keepParams(search)}
          />
          <Pager label="Document pages" base={`/deals/${dealId}/documents`} links={pagerLinks({ ...documents.data, itemCount: documents.data.items.length }, docsAt, keepParams(search), 'docs')} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {page?.kind === 'ok'
                ? page.data.fileName
                : 'Document'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {page?.kind === 'ok' && writer && openDocument && openDocument.status === 'AVAILABLE' && !openDocument.aiExcluded ? (
              <div className="mb-4">
                {TABLE_TYPES.has(openDocument.contentType) ? (
                  <ReadSpreadsheet dealId={dealId} documentId={openDocument.id} target={importTargetOf(openDocument)} />
                ) : aiOn ? (
                  <ExtractionAssistant key={openDocument.id} dealId={dealId} documentId={openDocument.id} />
                ) : null}
              </div>
            ) : null}
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
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Review queue</CardTitle>
            <nav aria-label="Review queue" className="flex gap-2 text-sm">
              {([['drafts', 'To review'], ['decided', 'Decided']] as const).map(([key, label]) => (
                <Link
                  key={key}
                  href={`/deals/${dealId}/documents?${libraryHref(keepParams(search), { queue: key === 'drafts' ? undefined : key, 'queue.cursor': undefined, 'queue.trail': undefined })}`}
                  aria-current={(key === 'decided') === decidedTab ? 'page' : undefined}
                  className={`rounded-full border px-3 py-1 ${(key === 'decided') === decidedTab ? 'border-indigo-ink bg-muted font-semibold' : 'border-border text-muted-foreground'}`}
                >
                  {label}
                  {key === 'drafts' && !decidedTab && findings.kind === 'ok' ? ` (${findings.data.total})` : ''}
                </Link>
              ))}
            </nav>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {findings.kind !== 'ok' ? (
              <ApiState result={findings} />
            ) : queue.length === 0 && decidedTab ? (
              <EmptyState title="Nothing decided yet" description="Accepted and rejected drafts appear here." />
            ) : queue.length === 0 ? (
              <EmptyState
                title="Nothing to review"
                description="Upload documents above. With AI on, extraction starts on its own and drafts appear here."
              />
            ) : (
              <ReviewQueue dealId={dealId} findings={queue} reviewer={reviewer} reviewerName={viewer.name(viewer.userId)} openPage={view.documentId ? { documentId: view.documentId, pageNumber: view.page } : null} />
            )}
            {findings.kind === 'ok' ? <Pager label="Review queue pages" base={`/deals/${dealId}/documents`} links={pagerLinks({ ...findings.data, itemCount: queue.length }, queueAt, keepParams(search), 'queue')} /> : null}
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

type SearchParams = Record<string, string | string[] | undefined>;
const DOC_SORTS = ['uploaded', 'name', 'pages'] as const;

/** The library's search, type and order from the URL (T-126), and the API query for them. */
function libraryQuery(search: SearchParams) {
  const one = (key: string) => (typeof search[key] === 'string' ? (search[key] as string).trim().slice(0, 200) : '');
  const q = one('q');
  const kind = one('kind');
  const sort = (DOC_SORTS as readonly string[]).includes(one('sort')) ? (one('sort') as (typeof DOC_SORTS)[number]) : 'uploaded';
  const dir = one('dir') === 'desc' ? 'desc' : 'asc';
  const api = new URLSearchParams({ sort, dir, ...(q ? { q } : {}), ...(kind ? { kind } : {}) }).toString();
  return { api, filters: { q, kind: kind || 'ALL', sort, dir } as const, filtered: Boolean(q || kind) };
}

const docsQuery = (query: string) => (query ? `&${query}` : '');
