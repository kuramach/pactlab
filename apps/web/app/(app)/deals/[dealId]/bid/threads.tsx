import { Button } from '@pactlab/ui';

export interface CommentView {
  id: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  quote: string | null;
  body: string;
  authorSide: 'BIDDER' | 'SELLER';
  authorName: string | null;
  createdAt: string;
  replies?: CommentView[];
}

export interface BidFileView {
  id: string;
  fileName: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
}

const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1 text-sm';

/**
 * Comment threads on shared documents (T-097): a bidder's comment and the
 * replies in it. Each thread belongs to one bid — the seller and that firm
 * see it; no other bidder does. `reply` is the form action for a reply.
 */
export function CommentThreads({ comments, reply, replyLabel }: { comments: readonly CommentView[]; reply: (comment: CommentView) => (form: FormData) => Promise<void>; replyLabel: string }) {
  if (comments.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3">
      {comments.map((comment) => (
        <li key={comment.id} className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <div className="text-xs text-muted-foreground">
            {comment.documentName}
            {comment.pageNumber ? `, page ${comment.pageNumber}` : ''} · {comment.createdAt.slice(0, 10)}
          </div>
          {comment.quote ? <blockquote className="border-l-2 border-border pl-2 italic text-muted-foreground">“{comment.quote}”</blockquote> : null}
          <p>
            <span className="font-medium">{comment.authorName ?? 'Bidder'}:</span> {comment.body}
          </p>
          {(comment.replies ?? []).map((entry) => (
            <p key={entry.id} className="ml-4 border-l-2 border-indigo/40 pl-2">
              <span className="font-medium">{entry.authorSide === 'SELLER' ? `${entry.authorName ?? 'Seller'} (seller)` : (entry.authorName ?? 'Bidder')}:</span> {entry.body}
            </p>
          ))}
          <form action={reply(comment)} className="ml-4 flex items-start gap-2">
            <textarea name="body" rows={1} required aria-label={`${replyLabel} on ${comment.documentName}`} className={inputClass} />
            <Button type="submit" size="sm" variant="outline">
              {replyLabel}
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}

export function BidFiles({ dealId, files }: { dealId: string; files: readonly BidFileView[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="list-disc pl-5 text-sm">
      {files.map((file) => (
        <li key={file.id}>
          <a href={`/deals/${dealId}/bid-files/${file.id}`} className="hover:underline">
            {file.fileName}
          </a>{' '}
          <span className="text-xs text-muted-foreground">
            ({Math.max(1, Math.round(file.sizeBytes / 1024))} KB{file.uploadedBy ? `, ${file.uploadedBy}` : ''}, {file.createdAt.slice(0, 10)})
          </span>
        </li>
      ))}
    </ul>
  );
}
