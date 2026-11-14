'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * While the website is being read (T-123), refresh the page every two seconds so the suggestions
 * appear on their own. After 30 seconds, stop and say so plainly instead of waiting forever.
 */
export function BrandFetchWait() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > 30_000) {
        window.clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [router]);
  return gaveUp ? (
    <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
      This is taking longer than usual. The website may be slow or may block automated visits. Try “Fetch again” in a minute, or upload your logo and pick your colors below.
    </p>
  ) : (
    <p role="status" className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
      <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-ink border-t-transparent" />
      Reading your website… the suggestions appear here in a few seconds.
    </p>
  );
}
