'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The one wait state for work that finishes after the page loads (T-125): refreshes the page while
 * the work runs, says plainly that it is running, and after a bound stops and says it is taking
 * longer than usual, with what to do. Never an endless spinner, never silence.
 */
export function Pending({
  label,
  slow,
  everyMs = 2_000,
  slowAfterMs = 30_000,
}: {
  /** What is happening, e.g. "Reading your website…". */
  label: string;
  /** What to say once it is slower than usual, with the next step. */
  slow: string;
  everyMs?: number;
  slowAfterMs?: number;
}) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > slowAfterMs) {
        window.clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs, slowAfterMs]);
  return gaveUp ? (
    <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      {slow}
    </p>
  ) : (
    <p role="status" className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
      <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-ink border-t-transparent" />
      {label}
    </p>
  );
}
