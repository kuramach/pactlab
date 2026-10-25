'use client';

import { Bug } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { fileBugReport } from './actions';
import { captureAppView, pageContext } from './capture';

type Screenshot = { contentType: 'image/jpeg'; data: string } | null;
type ErrorDetail = { name: string; message: string; stack?: string };
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKER';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const dealIdOf = (path: string) => /^\/deals\/([0-9a-f-]{36})(\/|$)/.exec(path)?.[1] ?? null;

/** Open the report dialog from anywhere (the error boundary uses this). */
export const OPEN_BUG_REPORT_EVENT = 'pactlab:report-bug';

/**
 * The in-app bug reporter (T-072): a floating button on every signed-in page,
 * a dialog that attaches the page context and a masked screenshot of the app
 * view, and a non-blocking prompt when an unhandled error happens. Errors are
 * filed even when the prompt is dismissed (deduplicated by fingerprint).
 */
export function BugReporter({ appVersion, environment }: { appVersion: string; environment: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [screenshot, setScreenshot] = useState<Screenshot>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<ErrorDetail | null>(null);
  const [prompt, setPrompt] = useState<ErrorDetail | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = useCallback(async (detail: ErrorDetail | null) => {
    setError(detail);
    setSent(null);
    setMessage(null);
    setCapturing(true);
    // Capture before the dialog opens, so the screenshot shows the page, not the dialog.
    const root = document.querySelector<HTMLElement>('[data-app-root]') ?? document.body;
    setScreenshot(await captureAppView(root));
    setCapturing(false);
    dialog.current?.showModal();
  }, []);

  const context = useCallback(
    (detail: ErrorDetail | null) => ({ ...pageContext(), appVersion, environment, ...(detail ? { error: { name: detail.name.slice(0, 200), message: detail.message.slice(0, 2000), ...(detail.stack ? { stack: detail.stack.slice(0, 8000) } : {}) } } : {}) }),
    [appVersion, environment],
  );

  // Unhandled errors: file them (zero effort), then offer to add details and a screenshot.
  useEffect(() => {
    const seen = new Set<string>();
    const report = (detail: ErrorDetail) => {
      const key = `${detail.name}:${detail.message}`;
      if (seen.has(key)) return;
      seen.add(key);
      void fileBugReport({ trigger: 'FRONTEND_EXCEPTION', title: 'Something went wrong', severity: 'MEDIUM', dealId: dealIdOf(window.location.pathname) ?? '', context: context(detail) });
      setPrompt(detail);
    };
    const onError = (event: ErrorEvent) => report({ name: event.error?.name ?? 'Error', message: event.message, stack: event.error?.stack });
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { name?: string; message?: string; stack?: string } | undefined;
      report({ name: reason?.name ?? 'UnhandledRejection', message: reason?.message ?? String(event.reason), ...(reason?.stack ? { stack: reason.stack } : {}) });
    };
    const onOpen = (event: Event) => void open((event as CustomEvent<ErrorDetail | null>).detail ?? null);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener(OPEN_BUG_REPORT_EVENT, onOpen);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener(OPEN_BUG_REPORT_EVENT, onOpen);
    };
  }, [context, open]);

  const submit = (form: FormData) =>
    startTransition(async () => {
      const result = await fileBugReport({
        trigger: error ? 'FRONTEND_EXCEPTION' : 'USER_REPORT',
        title: String(form.get('title') ?? ''),
        whatHappened: String(form.get('whatHappened') ?? ''),
        expected: String(form.get('expected') ?? ''),
        severity: (String(form.get('severity') ?? 'MEDIUM') as Severity) || 'MEDIUM',
        dealId: dealIdOf(window.location.pathname) ?? '',
        context: context(error),
        screenshot: form.get('includeScreenshot') && screenshot ? screenshot : null,
      });
      if (result.ok) setSent(result.reference);
      else setMessage(result.message);
    });

  return (
    <div data-bug-report-ui>
      {prompt ? (
        <div role="status" className="fixed bottom-20 right-4 z-40 flex max-w-sm flex-col gap-2 rounded-xl border border-border bg-card p-4 text-sm shadow-xl">
          <span className="font-semibold">Something went wrong — send a bug report?</span>
          <span className="text-muted-foreground">It was logged automatically. Add a line and a screenshot to help fix it.</span>
          <div className="flex gap-2">
            <button type="button" className="rounded-md bg-indigo px-3 py-1.5 font-semibold text-navy" onClick={() => { setPrompt(null); void open(prompt); }}>
              Add details
            </button>
            <button type="button" className="rounded-md border border-border px-3 py-1.5" onClick={() => setPrompt(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Report a bug"
        title="Report a bug"
        disabled={capturing}
        onClick={() => void open(null)}
        className="fixed bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-navy text-white shadow-lg ring-1 ring-white/20 hover:bg-navy/90 focus:outline-none focus:ring-2 focus:ring-indigo"
      >
        <Bug aria-hidden className="h-5 w-5" />
      </button>
      <dialog ref={dialog} aria-labelledby="bug-report-title" className="w-full max-w-lg rounded-2xl border border-border bg-card p-0 text-sm shadow-2xl backdrop:bg-navy/40">
        {sent ? (
          <div className="flex flex-col gap-3 p-5">
            <h2 id="bug-report-title" className="text-base font-semibold">Thanks — report {sent} sent</h2>
            <p className="text-muted-foreground">You can follow its status under Settings → My bug reports.</p>
            <button type="button" className="self-start rounded-md border border-border px-3 py-1.5" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </div>
        ) : (
          <form action={submit} className="flex flex-col gap-3 p-5">
            <h2 id="bug-report-title" className="text-base font-semibold">{error ? 'Something went wrong — tell us more' : 'Report a bug'}</h2>
            {message ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">{message}</p> : null}
            <label className="flex flex-col gap-1 font-medium">
              Title
              <input name="title" required minLength={3} maxLength={200} defaultValue={error ? `Error: ${error.message.slice(0, 120)}` : ''} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 font-medium">
              What happened
              <textarea name="whatHappened" rows={3} maxLength={5000} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 font-medium">
              What you expected
              <textarea name="expected" rows={2} maxLength={5000} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 font-medium">
              Severity
              <select name="severity" defaultValue={error ? 'MEDIUM' : 'LOW'} className={inputClass}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="BLOCKER">Blocker — I can’t continue</option>
              </select>
            </label>
            {screenshot ? (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="includeScreenshot" defaultChecked /> Attach this screenshot of the page
                </label>
                <img src={`data:${screenshot.contentType};base64,${screenshot.data}`} alt="Screenshot of the page that will be attached" className="max-h-40 rounded border border-border object-contain object-top" />
                <span className="text-xs text-muted-foreground">Only this app’s page, with password fields and private values left out.</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No screenshot could be taken of this page; the report will still include where you were.</p>
            )}
            <p className="text-xs text-muted-foreground">Attached automatically: the page you are on, browser, app version and time. Never passwords or tokens.</p>
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="rounded-md bg-indigo px-3 py-1.5 font-semibold text-navy">
                {pending ? 'Sending…' : 'Send report'}
              </button>
              <button type="button" className="rounded-md border border-border px-3 py-1.5" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
