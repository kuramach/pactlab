'use client';

import { sectionApplies, type CompanyType } from '@pactlab/domain';
import { Button } from '@pactlab/ui';
import { Compass, Lightbulb, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SHOWCASE, TOUR_PATHS } from '../../../../lib/showcase';
import { hideGuide } from '../../_lib/guide-actions';
import { DEAL_SECTIONS } from './deal-tabs';

const TOUR_KEY = 'pactlab_tour_step';
const read = (key: string) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the tour still works for this page.
  }
};

/**
 * "Why this matters" for the section on screen, plus the guided tour through the pact
 * (Kumar, 2026-11-13). The tour moves between sections in story order, skipping any this pact
 * does not have. Hide it here or in Settings.
 */
export function Showcase({ dealId, companyType, sellerLed }: { dealId: string; companyType: CompanyType | null; sellerLed: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const base = `/deals/${dealId}`;
  const section = pathname.startsWith(base) ? pathname.slice(base.length).replace(/\/$/, '') : '';
  const entry = SHOWCASE[section];
  // Tabs this app has and this pact shows (copy can arrive before its tab does).
  const steps = TOUR_PATHS.filter((path) => DEAL_SECTIONS.some((section) => section.path === path) && sectionApplies(path, { companyType, initiatedBy: sellerLed ? 'SELLER' : 'BUYER' }));
  const [touring, setTouring] = useState(false);
  useEffect(() => setTouring(read(TOUR_KEY) === dealId), [dealId]);
  const index = steps.indexOf(section);
  const go = (path: string | undefined) => {
    if (path === undefined) return;
    router.push(`${base}${path}`);
  };
  const start = () => {
    write(TOUR_KEY, dealId);
    setTouring(true);
    go(steps[0]);
  };
  const stop = () => {
    write(TOUR_KEY, null);
    setTouring(false);
  };
  if (!entry) return null;

  return (
    <aside aria-label="Why this matters" className="rounded-xl border border-indigo/30 bg-indigo/5 p-4 text-sm">
      <div className="flex flex-wrap items-start gap-3">
        <Lightbulb aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-indigo-ink" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-semibold text-navy">
            {touring && index >= 0 ? <span className="mr-2 text-xs font-bold uppercase tracking-wide text-indigo-ink">Tour · {index + 1} of {steps.length}</span> : null}
            {entry.title}
          </p>
          <p className="text-slate-text">{entry.why}</p>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {entry.lookFor.map((item) => (
              <li key={item} className="before:mr-1 before:text-indigo-ink before:content-['→']">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {touring ? (
            <>
              <Button type="button" size="sm" variant="outline" disabled={index <= 0} onClick={() => go(steps[index - 1])}>
                Back
              </Button>
              {index >= 0 && index < steps.length - 1 ? (
                <Button type="button" size="sm" onClick={() => go(steps[index + 1])}>
                  Next
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={stop}>
                  Finish tour
                </Button>
              )}
              {index < 0 ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => go(steps[0])}>
                  Back to the tour
                </Button>
              ) : null}
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={start}>
              <Compass aria-hidden className="h-4 w-4" /> Take the tour
            </Button>
          )}
          <form action={hideGuide}>
            <Button type="submit" size="sm" variant="ghost" aria-label="Hide the guide">
              <X aria-hidden className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}
