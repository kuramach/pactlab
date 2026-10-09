import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '../../../components/cta';
import { Icon, IconTile } from '../../../components/icon';
import { FOUNDER, PILOT, type IconName } from '../../../lib/content';

export const metadata: Metadata = {
  title: 'Founder’s vision',
  description: FOUNDER.title,
};

/** The founder's vision for Pactlab, in his own voice. */
export default function VisionPage() {
  return (
    <>
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-[1.4fr_1fr] md:py-20">
          <div className="flex flex-col gap-5">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo">Founder’s vision</p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">{FOUNDER.title}</h1>
            <p className="max-w-2xl text-lg leading-relaxed text-white/85">{FOUNDER.intro}</p>
          </div>
          <figure className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <img
              src={FOUNDER.photo}
              alt={`Portrait of ${FOUNDER.name}`}
              width={380}
              height={380}
              className="h-44 w-44 rounded-full object-cover ring-4 ring-indigo/60"
            />
            <figcaption>
              <p className="text-lg font-bold">{FOUNDER.name}</p>
              <p className="text-sm text-white/70">{FOUNDER.role}</p>
              <a
                href={FOUNDER.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold hover:border-indigo hover:text-indigo"
              >
                Connect on LinkedIn ↗
              </a>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="max-w-3xl text-xl font-semibold leading-relaxed">{FOUNDER.dealsIntro}</p>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FOUNDER.deals.map((deal) => (
              <li key={deal.title} className="flex flex-col gap-3 rounded-2xl border border-navy/10 bg-mist p-6">
                <IconTile name={deal.icon as IconName} />
                <h2 className="text-lg font-bold">{deal.title}</h2>
                <p className="text-slate-text">{deal.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{FOUNDER.problemTitle}</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {FOUNDER.problems.map((problem, index) => (
              <article key={problem.title} className="flex flex-col gap-3 rounded-2xl bg-white p-7 shadow-sm">
                <span className="text-sm font-bold text-indigo-ink">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="text-xl font-bold">{problem.title}</h3>
                <p className="leading-relaxed text-slate-text">{problem.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{FOUNDER.visionTitle}</h2>
            <p className="mt-5 text-xl leading-relaxed text-slate-text">{FOUNDER.vision}</p>
          </div>
          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            {FOUNDER.phases.map((phase, index) => (
              <li key={phase.phase} className="relative flex flex-col gap-3 rounded-2xl border border-indigo/20 p-7">
                <span className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-navy text-indigo">
                    <Icon name={phase.icon as IconName} className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-bold uppercase tracking-widest text-indigo-ink">{phase.phase}</span>
                </span>
                <h3 className="text-xl font-bold">{phase.title}</h3>
                <p className="leading-relaxed text-slate-text">{phase.body}</p>
                {index < FOUNDER.phases.length - 1 ? (
                  <span aria-hidden className="absolute -right-4 top-1/2 hidden h-0.5 w-3 bg-indigo/40 md:block" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-navy text-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-20">
          <blockquote className="text-3xl font-extrabold leading-snug tracking-tight sm:text-4xl">“{FOUNDER.signoff}”</blockquote>
          <p className="font-semibold text-white/80">
            —{' '}
            <a href={FOUNDER.linkedin} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
              {FOUNDER.name}
            </a>
          </p>
          <Link href="/about/story" className="font-semibold text-indigo underline-offset-4 hover:underline">
            Why we called it Pactlab →
          </Link>
        </div>
      </section>

      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
