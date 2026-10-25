'use client';

import { useEffect, useState } from 'react';
import { fileBugReport } from './_lib/bugs/actions';
import { OPEN_BUG_REPORT_EVENT } from './_lib/bugs/bug-reporter';
import { pageContext } from './_lib/bugs/capture';

/**
 * A page that failed to render (T-072): the error is filed automatically and
 * the person sees a plain message with the reference — never a stack trace.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reference, setReference] = useState<string | null>(null);
  useEffect(() => {
    void fileBugReport({
      trigger: 'FRONTEND_EXCEPTION',
      title: 'A page failed to load',
      severity: 'HIGH',
      dealId: /^\/deals\/([0-9a-f-]{36})/.exec(window.location.pathname)?.[1] ?? '',
      context: { ...pageContext(), error: { name: error.name, message: error.digest ? `digest ${error.digest}` : error.message.slice(0, 2000), ...(error.stack ? { stack: error.stack.slice(0, 8000) } : {}) } },
    }).then((result) => setReference(result.ok ? result.reference : null));
  }, [error]);
  return (
    <div role="alert" className="flex max-w-xl flex-col gap-3 rounded-2xl border border-border p-6">
      <h2 className="text-lg font-semibold">Something went wrong.</h2>
      <p className="text-sm text-muted-foreground">
        We&apos;ve logged it automatically{reference ? <> — reference <strong>{reference}</strong></> : null}. You can keep working, or try again.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="rounded-md bg-indigo px-3 py-1.5 text-sm font-semibold text-navy">
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_BUG_REPORT_EVENT, { detail: { name: error.name, message: error.message } }))}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Tell us what you were doing
        </button>
      </div>
    </div>
  );
}
