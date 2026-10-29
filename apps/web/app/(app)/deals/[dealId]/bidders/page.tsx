import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { BidFiles, CommentThreads, type BidFileView, type CommentView } from '../bid/threads';
import { addBidder, answerQuestion, bidAction, inviteBidder, nextRound, replyToComment, saveProcess } from './actions';

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

interface BoardView {
  canRun: boolean;
  venture: boolean;
  process: { status: 'OPEN' | 'AWARDED' | 'CLOSED'; round: number; offerDeadline: string | null; sharedSummary: string | null; dataRoomUrl: string | null; ndaText: string | null; awardedBidId: string | null };
  bids: {
    id: string;
    firmName: string;
    status: string;
    round: number;
    ndaAcceptedAt: string | null;
    passReason: string | null;
    people: string[];
    invited: string[];
    latestOffer: OfferView | null;
    offers: OfferView[];
    openQuestions: number;
    comments: CommentView[];
    files: BidFileView[];
  }[];
  questions: { id: string; firmName: string; question: string; askedAt: string; answer: string | null; scope: 'PRIVATE' | 'ALL' | null }[];
  published: { id: string; question: string; answer: string }[];
}

const STATUS: Record<string, { label: string; tone: 'neutral' | 'reviewed' | 'draft' | 'danger' | 'calculation' }> = {
  INVITED: { label: 'Invited', tone: 'neutral' },
  ACTIVE: { label: 'Looking', tone: 'calculation' },
  OFFERED: { label: 'Offered', tone: 'reviewed' },
  SHORTLISTED: { label: 'Shortlisted', tone: 'reviewed' },
  PASSED: { label: 'Passed', tone: 'neutral' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
  WON: { label: 'Won', tone: 'reviewed' },
};

const OUTCOMES: Record<string, string> = {
  'ok-saved': 'Saved. Bidders see the shared view once they accept the NDA.',
  'ok-bidder-added': 'Bidder added. Invite their people below.',
  'ok-invited': 'Invitation sent. They join this pact as that firm’s bidder only.',
  'already-invited': 'That person already has a pending invitation.',
  'ok-shortlist': 'Shortlisted for the next round.',
  'ok-decline': 'Declined. Their access has ended; their records stay.',
  'ok-award': 'Awarded. Every other bidder has been declined and their access ended.',
  'ok-round-model': 'Added to the round comparison on the Raise tab.',
  'ok-next-round': 'Next round started. Bidders not shortlisted were declined.',
  'ok-answered': 'Answered privately: only that bidder sees it.',
  'ok-answered-all': 'Answered to all bidders, without naming who asked.',
  'ok-replied': 'Reply sent. Only that bidder sees it.',
  'firm-missing': 'Name the bidding firm.',
  'answer-missing': 'Write an answer first.',
  conflict: 'That cannot be done in the bid’s current state.',
  invalid: 'That was not accepted — check the details. An award needs an offer; a round needs someone shortlisted.',
  forbidden: 'Only the seller’s deal lead or analysts can run the bid process.',
};

const money = (offer: OfferView) => `${offer.currency} ${Number(offer.price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1 text-sm';

/**
 * The seller's bid process (T-097): the shared view and NDA, the bidders
 * board, offers side by side, and the questions inbox. Pactlab compares
 * offers but never ranks them or recommends one — the seller decides.
 */
export default async function BiddersPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const board = await apiGet<BoardView>(`/v1/deals/${dealId}/sale`);
  if (board.kind !== 'ok') {
    return board.kind === 'not-found' ? <EmptyState title="Not a seller-led pact" description="This pact was started by a buyer. Bid processes run on pacts the seller starts." /> : <ApiState result={board} />;
  }
  const { process, bids, questions, published, canRun, venture } = board.data;
  const open = process.status === 'OPEN';
  const offers = bids.filter((bid) => bid.latestOffer);
  const shortlisted = bids.filter((bid) => bid.status === 'SHORTLISTED').length;
  const unanswered = questions.filter((question) => question.answer === null);

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={open ? 'calculation' : 'reviewed'}>{open ? `Round ${process.round} open` : process.status === 'AWARDED' ? 'Awarded' : 'Closed'}</Badge>
        {process.offerDeadline ? <span className="text-muted-foreground">Offers due {process.offerDeadline.slice(0, 16).replace('T', ' ')} UTC</span> : <span className="text-muted-foreground">No offer deadline set</span>}
        {canRun && open && shortlisted > 0 ? (
          <form action={nextRound.bind(null, dealId)}>
            <Button type="submit" size="sm" variant="outline">
              Start round {process.round + 1} with {shortlisted} shortlisted
            </Button>
          </form>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bidders</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {bids.length === 0 ? <p className="text-muted-foreground">No bidders yet. Add the firms you want to invite.</p> : null}
          <ul className="flex flex-col divide-y divide-border">
            {bids.map((bid) => (
              <li key={bid.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{bid.firmName}</span>
                  <span className="flex items-center gap-2">
                    {bid.openQuestions > 0 ? <span className="text-xs text-muted-foreground">{bid.openQuestions} open question(s)</span> : null}
                    <Badge variant={STATUS[bid.status]?.tone ?? 'neutral'}>{STATUS[bid.status]?.label ?? bid.status}</Badge>
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {bid.people.length > 0 ? `People: ${bid.people.join(', ')}` : 'Nobody has joined yet'}
                  {bid.invited.length > 0 ? ` · Invited: ${bid.invited.join(', ')}` : ''}
                  {bid.ndaAcceptedAt ? ` · NDA accepted ${bid.ndaAcceptedAt.slice(0, 10)}` : ''}
                </div>
                {bid.latestOffer ? (
                  <div className="text-xs">
                    Latest offer (v{bid.latestOffer.version}, round {bid.latestOffer.round}): <span className="font-semibold">{money(bid.latestOffer)}</span> — {bid.latestOffer.structure}
                  </div>
                ) : null}
                {bid.passReason ? <div className="text-xs text-muted-foreground">Passed: {bid.passReason}</div> : null}
                {bid.files.length > 0 ? (
                  <div className="text-xs">
                    <span className="font-medium">Files from {bid.firmName}:</span>
                    <BidFiles dealId={dealId} files={bid.files} />
                  </div>
                ) : null}
                {bid.comments.length > 0 ? (
                  <details className="text-xs" open={bid.comments.some((comment) => (comment.replies ?? []).length === 0)}>
                    <summary className="cursor-pointer font-medium">
                      {bid.comments.length} comment thread(s) on your documents — only {bid.firmName} sees your replies
                    </summary>
                    <div className="mt-2">
                      <CommentThreads comments={bid.comments} reply={(comment) => replyToComment.bind(null, dealId, comment.id)} replyLabel="Reply" />
                    </div>
                  </details>
                ) : null}
                {canRun && open && ['INVITED', 'ACTIVE', 'OFFERED', 'SHORTLISTED'].includes(bid.status) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={inviteBidder.bind(null, dealId, bid.id)} className="flex items-center gap-2">
                      <input name="email" type="email" required placeholder="name@firm.com" aria-label={`Invite someone from ${bid.firmName}`} className="w-52 rounded-md border border-border bg-background px-2 py-1 text-xs" />
                      <Button type="submit" size="sm" variant="outline">
                        Invite
                      </Button>
                    </form>
                    {bid.status === 'OFFERED' || bid.status === 'ACTIVE' ? (
                      <form action={bidAction.bind(null, dealId, bid.id, 'shortlist')}>
                        <Button type="submit" size="sm" variant="outline">
                          Shortlist
                        </Button>
                      </form>
                    ) : null}
                    {bid.latestOffer ? (
                      <form action={bidAction.bind(null, dealId, bid.id, 'award')}>
                        <Button type="submit" size="sm">
                          Award to {bid.firmName}
                        </Button>
                      </form>
                    ) : null}
                    {venture && bid.latestOffer?.preMoney ? (
                      <form action={bidAction.bind(null, dealId, bid.id, 'round-model')}>
                        <Button type="submit" size="sm" variant="outline">
                          Add to round comparison
                        </Button>
                      </form>
                    ) : null}
                    <form action={bidAction.bind(null, dealId, bid.id, 'decline')}>
                      <Button type="submit" size="sm" variant="ghost">
                        Decline
                      </Button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {canRun && open ? (
            <form action={addBidder.bind(null, dealId)} className="flex flex-wrap items-center gap-2">
              <input name="firmName" required placeholder="Bidding firm, e.g. Harbor Capital" aria-label="Bidding firm" className="w-72 rounded-md border border-border bg-background px-2 py-1" />
              <Button type="submit" size="sm">
                Add bidder
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {offers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Offers side by side</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-xs text-muted-foreground">Each bidder’s latest offer. Pactlab sets the terms out next to each other; it does not rank them or recommend one.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium" scope="col">
                      Term
                    </th>
                    {offers.map((bid) => (
                      <th key={bid.id} className="py-1 pr-3 font-medium" scope="col">
                        {bid.firmName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Price', (offer: OfferView) => money(offer)],
                      ...(venture ? ([['Pre-money', (offer: OfferView) => (offer.preMoney ? `${offer.currency} ${Number(offer.preMoney).toLocaleString('en-US')}` : '—')]] as const) : []),
                      ['Structure', (offer: OfferView) => offer.structure],
                      ['Conditions', (offer: OfferView) => offer.conditions ?? '—'],
                      ['Valid until', (offer: OfferView) => offer.validUntil ?? '—'],
                      ['Version', (offer: OfferView) => `v${offer.version} · round ${offer.round} · ${offer.submittedAt.slice(0, 10)}`],
                    ] as const
                  ).map(([label, value]) => (
                    <tr key={label} className="border-t border-border align-top">
                      <th scope="row" className="py-2 pr-3 text-xs font-medium text-muted-foreground">
                        {label}
                      </th>
                      {offers.map((bid) => (
                        <td key={bid.id} className="py-2 pr-3">
                          {value(bid.latestOffer as OfferView)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Questions from bidders {unanswered.length > 0 ? `· ${unanswered.length} to answer` : ''}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {questions.length === 0 ? <p className="text-muted-foreground">No questions yet.</p> : null}
          {questions.map((question) => (
            <div key={question.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">
                {question.firmName} · {question.askedAt.slice(0, 10)}
              </div>
              <p>{question.question}</p>
              {question.answer ? (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">{question.scope === 'ALL' ? 'Answered to all bidders' : 'Answered privately'}:</span> {question.answer}
                </p>
              ) : canRun ? (
                <form action={answerQuestion.bind(null, dealId, question.id)} className="flex flex-col gap-2">
                  <textarea name="answer" required rows={2} aria-label="Answer" className={inputClass} />
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      <input type="radio" name="scope" value="PRIVATE" defaultChecked /> Only {question.firmName}
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="scope" value="ALL" /> All bidders (without naming who asked)
                    </label>
                    <Button type="submit" size="sm">
                      Answer
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ))}
          {published.length > 0 ? <p className="text-xs text-muted-foreground">{published.length} answer(s) published to all bidders.</p> : null}
        </CardContent>
      </Card>

      {canRun && open ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What bidders see</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={saveProcess.bind(null, dealId)} className="flex flex-col gap-3 text-sm">
              <label className="flex flex-col gap-1">
                Shared summary — everything here is visible to every bidder after the NDA
                <textarea name="sharedSummary" rows={4} defaultValue={process.sharedSummary ?? ''} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                Your data room (link) — Pactlab is not the data room; grant bidders access there
                <input name="dataRoomUrl" type="url" placeholder="https://" defaultValue={process.dataRoomUrl ?? ''} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                NDA — bidders must accept it before seeing anything else (leave empty for none)
                <textarea name="ndaText" rows={3} defaultValue={process.ndaText ?? ''} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                Offer deadline (UTC)
                <input name="offerDeadline" type="datetime-local" defaultValue={process.offerDeadline ? process.offerDeadline.slice(0, 16) : ''} className={`${inputClass} w-64`} />
              </label>
              <p className="text-xs text-muted-foreground">Documents for bidders: on Documents, tick “Share with bidders” when you upload them.</p>
              <div>
                <Button type="submit" size="sm">
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
