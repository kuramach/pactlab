import { Glossed, PactlabLockup, PACTLAB_PROMISE, PACTLAB_TAGLINE } from '@pactlab/ui';
import { Compass, Orbit, ShieldCheck, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

const PILLARS = [
  { icon: Sparkles, title: 'AI rigor. Human judgment.', body: 'Every invoice, commit and clause read and cited — every decision signed by a person.' },
  { icon: Orbit, title: 'A 360° view of the deal', body: 'Revenue, code, delivery, contracts, valuation and human capital in one place.' },
  { icon: Compass, title: 'Sextant for smart M&A', body: 'Priced risks, scenarios and the purchase-price bridge — tested against the asking price.' },
  { icon: ShieldCheck, title: 'Security first, built on AWS', body: 'Each organization isolated in the database, every sensitive read audited.' },
] as const;

/**
 * Sign-in, sign-up and organization pages in the website's design: a navy
 * brand panel with the lockup and promises, and the form on white.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[30rem] w-[30rem] rounded-full bg-indigo/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-teal/10 blur-3xl" />
        <PactlabLockup tone="onDark" className="relative" />
        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo">
              Diligence for <Glossed text="M&A" />
            </p>
            <h1 className="max-w-md text-4xl font-extrabold leading-tight tracking-tight">{PACTLAB_PROMISE}</h1>
          </div>
          <ul className="grid max-w-xl gap-4 sm:grid-cols-2">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo/20 text-indigo">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <span className="font-bold">
                  <Glossed text={title} />
                </span>
                <span className="text-sm leading-relaxed text-white/70">
                  <Glossed text={body} />
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/50">
          <Glossed text={PACTLAB_TAGLINE} />
        </p>
      </section>
      <section className="flex flex-col items-center justify-center gap-8 bg-mist p-6 sm:p-10">
        <PactlabLockup className="lg:hidden" />
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
