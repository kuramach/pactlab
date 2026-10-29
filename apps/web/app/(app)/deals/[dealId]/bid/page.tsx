import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { acceptNda, askQuestion, attachFile, commentOnDocument, passBid, startLinkedPact, submitOffer } from './actions';
import { BidFiles, CommentThreads, type BidFileView, type CommentView } from './threads';

interface OfferView {
  id: string;
  version: number;
  round: number;
  price: string;
  currency: string;
  preMoney: string | null;
  structure: string;
  conditions: string | null;
  validUntil: string | null;
  submittedAt: string;
}

interface MyBidView {
  pact: { organizationId: string; dealId: string; name: string; company: string; companyType: string | null; currency: string };
  handover: { sellerLeadName: string | null; sellerLeadEmail: string | null } | null;
  process: { status: 'OPEN' | 'AWARDED' | 'CLOSED'; round: number; offerDeadline: string | null; ndaText: string | null; sharedSummary: string | null; dataRoomUrl: string | null };
  bid: { id: string; firmName: string; status: string; round: number; ndaAccepted: boolean; passReason: string | null };
  offers: OfferView[];
  comments: CommentView[];
  files: BidFileView[];
  questions: { id: string; question: string; askedAt: string; answer: string | null; scope: 'PRIVATE' | 'ALL' | null }[];
  published: { id: string; question: string; answer: string; publishedAt: string }[];
}

const OUTCOMES: Record<string, string> = {
  'ok-nda': 'NDA accepted. The seller’s shared view is open.',
  'ok-asked': 'Question sent to the seller. Only your firm sees it unless the seller answers it to all bidders — and then without naming you.',
  'ok-offered': 'Offer submitted. You can revise it until the deadline; every version is kept.',
  'ok-passed': 'You have passed on this pact.',
  'offer-invalid': 'Check the offer: a price above zero, a currency and a few words on structure.',
  'question-short': 'Write a question of at least a few words.',
  'ok-commented': 'Comment sent. Only the seller and your firm see it.',
  'ok-attached': 'File attached to your bid. Only the seller and your firm see it.',
  'comment-empty': 'Write a comment first.',
  'file-missing': 'Choose a file to attach.',
  'file-type': 'Attach a PDF, Word, Excel, CSV, text or Markdown file.',
  'file-rejected': 'The file was refused: it may be empty, unreadable, too large or flagged by the virus scan.',
  'not-won': 'Only the winning bidder starts a diligence pact from the sale.',
  'no-home': 'Your own organization could not be opened. Sign out and in again, then try once more.',
  conflict: 'That cannot be done now — the deadline may have passed or the process has closed.',
  forbidden: 'Accept the NDA first.',
};

const STANDING: Record<string, string> = {
  INVITED: 'Invited',
  ACTIVE: 'In the process',
  OFFERED: 'Offer received by the seller',
  SHORTLISTED: 'Shortlisted for the next round',
  PASSED: 'You passed',
  DECLINED: 'Not taken forward',
  WON: 'Selected by the seller',
};

const money = (currency: string, value: string) => `${currency} ${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1 text-sm';

interface SharedDocument {
  id: string;
  fileName: string;
  pageCount: number;
}

/**
 * A bidder's own bid (T-097): the seller's NDA, then their shared view,
 * questions and answers, and the offer form. A bidder only ever sees their
 * own bid — never another bidder.
 */
export default async function BidPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const mine = await apiGet<MyBidView>(`/v1/deals/${dealId}/my-bid`);
  if (mine.kind !== 'ok') return <ApiState result={mine} />;
  const { pact, process, bid, offers, questions, published, comments, files } = mine.data;
  const ndaPending = Boolean(process.ndaText) && !bid.ndaAccepted;
  const live = process.status === 'OPEN' && ['INVITED', 'ACTIVE', 'OFFERED', 'SHORTLISTED'].includes(bid.status);
  const documents = ndaPending ? null : await apiGet<{ items: SharedDocument[] }>(`/v1/deals/${dealId}/documents`);
  const latest = offers[offers.length - 1];

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{bid.firmName}</span>
        <Badge variant={bid.status === 'WON' ? 'reviewed' : bid.status === 'DECLINED' || bid.status === 'PASSED' ? 'neutral' : 'calculation'}>{STANDING[bid.status] ?? bid.status}</Badge>
        <span className="text-muted-foreground">Round {process.round}</span>
        {process.offerDeadline ? <span className="text-muted-foreground">Offers due {process.offerDeadline.slice(0, 16).replace('T', ' ')} UTC</span> : null}
      </div>

      {ndaPending ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Non-disclosure agreement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3">{process.ndaText}</p>
            <p className="text-xs text-muted-foreground">Accepting records your name and the time. Nothing else about {pact.company} is shown until you accept.</p>
            <form action={acceptNda.bind(null, dealId)}>
              <Button type="submit">I accept the NDA</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">From the seller</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {process.sharedSummary ? <p className="whitespace-pre-wrap">{process.sharedSummary}</p> : <p className="text-muted-foreground">The seller has not shared a summary yet.</p>}
              {process.dataRoomUrl ? (
                <p>
                  Data room:{' '}
                  <a href={process.dataRoomUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-ink hover:underline">
                    {process.dataRoomUrl}
                  </a>{' '}
                  <span className="text-xs text-muted-foreground">(access is granted by the seller there)</span>
                </p>
              ) : null}
              {documents?.kind === 'ok' && documents.data.items.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Shared documents</span>
                  <ul className="list-disc pl-5">
                    {documents.data.items.map((document) => (
                      <li key={document.id}>
                        <a href={`/deals/${dealId}/documents/${document.id}/original`} className="hover:underline">
                          {document.fileName}
                        </a>{' '}
                        <span className="text-xs text-muted-foreground">({document.pageCount} pp)</span>
                        {live ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-indigo-ink">Comment on {document.fileName}</summary>
                            <form action={commentOnDocument.bind(null, dealId, document.id, null)} className="mt-2 flex flex-col gap-2">
                              <div className="flex flex-wrap gap-2">
                                <input name="pageNumber" inputMode="numeric" placeholder="Page (optional)" aria-label={`Page in ${document.fileName}`} className="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm" />
                                <input name="quote" placeholder="Passage you mean (optional)" aria-label={`Passage in ${document.fileName}`} className="min-w-64 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm" />
                              </div>
                              <textarea name="body" rows={2} required aria-label={`Comment on ${document.fileName}`} className={inputClass} />
                              <div>
                                <Button type="submit" size="sm" variant="outline">
                                  Send comment to the seller
                                </Button>
                              </div>
                            </form>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {comments.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your comments on documents</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">Only the seller and your firm see these threads.</p>
                <CommentThreads comments={comments} reply={(comment) => commentOnDocument.bind(null, dealId, comment.documentId, comment.id)} replyLabel="Follow up" />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Questions and answers</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {questions.map((question) => (
                <div key={question.id} className="rounded-md border border-border p-3">
                  <p className="font-medium">{question.question}</p>
                  <p className="text-muted-foreground">{question.answer ?? 'Waiting for the seller’s answer.'}</p>
                </div>
              ))}
              {published.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Answered to all bidders</span>
                  {published.map((entry) => (
                    <div key={entry.id} className="rounded-md border border-border p-3">
                      <p className="font-medium">{entry.question}</p>
                      <p className="text-muted-foreground">{entry.answer}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {live ? (
                <form action={askQuestion.bind(null, dealId)} className="flex flex-col gap-2">
                  <textarea name="question" rows={2} required placeholder="Ask the seller a question" aria-label="Question for the seller" className={inputClass} />
                  <div>
                    <Button type="submit" size="sm" variant="outline">
                      Ask
                    </Button>
                  </div>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{latest ? 'Your offer' : 'Make an offer'}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              {offers.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {[...offers].reverse().map((offer) => (
                    <li key={offer.id} className={offer === latest ? 'font-medium' : 'text-muted-foreground'}>
                      v{offer.version} (round {offer.round}, {offer.submittedAt.slice(0, 10)}): {money(offer.currency, offer.price)} — {offer.structure}
                      {offer.conditions ? `; ${offer.conditions}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {live ? (
                <form action={submitOffer.bind(null, dealId)} className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    Price
                    <input name="price" required inputMode="decimal" placeholder="25,000,000" defaultValue={latest?.price ?? ''} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Currency
                    <input name="currency" required pattern="[A-Z]{3}" defaultValue={latest?.currency ?? pact.currency} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Pre-money valuation (investment rounds only)
                    <input name="preMoney" inputMode="decimal" defaultValue={latest?.preMoney ?? ''} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Valid until
                    <input name="validUntil" type="date" defaultValue={latest?.validUntil ?? ''} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    Structure (cash, shares, earn-out…)
                    <input name="structure" required defaultValue={latest?.structure ?? ''} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    Conditions
                    <textarea name="conditions" rows={2} defaultValue={latest?.conditions ?? ''} className={inputClass} />
                  </label>
                  <div className="sm:col-span-2">
                    <Button type="submit">{latest ? 'Submit revised offer' : 'Submit offer'}</Button>
                  </div>
                </form>
              ) : null}
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <span className="font-medium">Files with your bid</span>
                <BidFiles dealId={dealId} files={files} />
                {live ? (
                  <form action={attachFile.bind(null, dealId)} className="flex flex-wrap items-center gap-2">
                    <input name="file" type="file" required accept=".pdf,.docx,.xlsx,.csv,.txt,.md" aria-label="File to attach to your bid" className="text-sm" />
                    <Button type="submit" size="sm" variant="outline">
                      Attach a file
                    </Button>
                    <span className="text-xs text-muted-foreground">A marked-up agreement, a letter of intent… Only the seller and your firm see it.</span>
                  </form>
                ) : null}
              </div>
              {live ? (
                <form action={passBid.bind(null, dealId)} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <input name="reason" placeholder="Why you are passing (optional, seller only)" aria-label="Reason for passing" className="w-80 rounded-md border border-border bg-background px-2 py-1" />
                  <Button type="submit" size="sm" variant="ghost">
                    Pass on this pact
                  </Button>
                </form>
              ) : null}
              {bid.status === 'WON' ? (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
                  <p className="font-medium">The seller has selected your offer.</p>
                  <p>
                    Do your own diligence in a pact of your own: Pactlab starts a buyer-led pact in <span className="font-medium">your</span> organization, linked to this sale, and invites{' '}
                    {mine.data.handover?.sellerLeadName ?? 'the seller’s deal lead'} into it as the seller. Your analysis stays with your team — the seller sees only what you share.
                  </p>
                  <form action={startLinkedPact.bind(null, dealId)}>
                    <Button type="submit">Start your diligence pact</Button>
                  </form>
                </div>
              ) : null}
              {bid.status === 'PASSED' && bid.passReason ? <p className="text-muted-foreground">You passed: {bid.passReason}</p> : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
