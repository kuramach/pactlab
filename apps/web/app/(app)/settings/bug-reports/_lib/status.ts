/** How a report's status reads to the person who filed it (Bugs submitted). */
export const STATUS_LABELS: Record<string, string> = { NEW: 'New', TRIAGED: 'Triaged', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', WONT_FIX: 'Won’t fix' };

export const STATUS_MEANING: Record<string, string> = {
  NEW: 'Received — waiting for someone at Pactlab to look at it.',
  TRIAGED: 'Confirmed — we know what is wrong and have queued a fix.',
  IN_PROGRESS: 'In progress — we are working on a fix.',
  RESOLVED: 'Resolved — the fix is live. Tell us with the bug button if it happens again.',
  WONT_FIX: 'Closed without a change — the reply below explains why.',
};

/** The usual path of a report; "Won’t fix" ends it early. */
export const STATUS_TRACK = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED'] as const;

export const isOpen = (status: string) => status !== 'RESOLVED' && status !== 'WONT_FIX';

export const statusBadge = (status: string) => (status === 'RESOLVED' ? 'calculation' : status === 'WONT_FIX' ? 'neutral' : 'draft');

export const SEVERITY_LABELS: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', BLOCKER: 'Blocker' };

export const TRIGGER_LABELS: Record<string, string> = {
  USER_REPORT: 'You reported it',
  FRONTEND_EXCEPTION: 'Reported automatically when an error happened on this page',
  BACKEND_EXCEPTION: 'Reported automatically when the server hit an error',
  JOB_EXHAUSTED: 'Reported automatically when background work failed',
};

/** "2026-11-02T15:42:00Z" → "2 Nov 2026". */
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The app page without its query string (which can carry search terms). */
export const pagePath = (page: string | null) => (page ? page.split('?')[0] : null);
