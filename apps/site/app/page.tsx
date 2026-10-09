import Link from 'next/link';
import { HeroCarousel } from '../components/hero-carousel';
import { Icon, IconTile } from '../components/icon';
import { Lockup } from '../components/lockup';
import { siteConfig } from '../lib/config';
import { CAROUSEL, CLOSING, FOUNDER, INDUSTRIES, MODULES, NAME_STORY, PILLAR, PRINCIPLES, STORY, TAGLINE } from '../lib/content';
import { Demos } from './demos';

const { contactHref, signUpUrl } = siteConfig();

function PrimaryCta({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  if (!contactHref) return null;
  return (
    <a
      href={contactHref}
      className={`inline-flex items-center rounded-lg px-5 py-3 font-bold transition-colors ${
        tone === 'dark' ? 'bg-indigo text-navy hover:bg-white' : 'bg-navy text-white hover:bg-indigo hover:text-navy'
      }`}
    >
      Talk to us
    </a>
  );
}

export default function HomePage() {
  return (
    <>
      <HeroCarousel slides={CAROUSEL} cta={contactHref ? { href: contactHref, label: 'Request a pilot' } : null} />

      {/* Value proposition */}
      <section aria-labelledby="value-title" className="bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-5">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo-ink">{PILLAR}</p>
            <h2 id="value-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Test the pact before you sign it.
            </h2>
            <p className="text-lg leading-relaxed text-slate-text">
              {STORY} Pactlab reads the revenue, the code, the delivery history, the contracts and the people behind them —
              then turns what it finds into priced risks and deal terms your team can defend.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/how-it-works" className="inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy hover:bg-navy hover:text-white">
                See how it works
              </Link>
              {signUpUrl ? (
                <a href={signUpUrl} className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
                  Create your organization →
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-center gap-5 rounded-3xl bg-mist p-10">
            <img src="/brand/pactlab-symbol.png" alt="" width={512} height={512} className="h-auto w-48" />
            <Lockup />
            <p className="text-center text-sm font-semibold text-slate-text">{TAGLINE}</p>
          </div>
        </div>
      </section>

      {/* The name */}
      <section aria-labelledby="name-title" className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[1fr_1.3fr]">
          <img
            src="/illustrations/fides-coin.svg"
            alt="A Roman coin showing clasped right hands, the emblem of Fides"
            width={480}
            height={480}
            className="mx-auto h-auto w-full max-w-xs"
          />
          <div className="flex flex-col gap-5">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo">{NAME_STORY.eyebrow}</p>
            <h2 id="name-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {NAME_STORY.title}
            </h2>
            <p className="text-lg leading-relaxed text-white/85">{NAME_STORY.teaser}</p>
            <p className="text-lg font-bold text-indigo">{NAME_STORY.closing}</p>
            <Link href="/about/story" className="font-semibold text-white underline-offset-4 hover:underline">
              Read the story of the pact →
            </Link>
          </div>
        </div>
      </section>

      {/* Solutions grid */}
      <section aria-labelledby="solutions-title" className="bg-mist">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h2 id="solutions-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Diligence for every part of the deal
              </h2>
              <p className="mt-4 text-lg text-slate-text">One evidence loop underneath. Every module cites its sources and waits for a reviewer.</p>
            </div>
            <Link href="/product" className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
              All modules →
            </Link>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module) => (
              <Link
                key={module.slug}
                href={`/product/${module.slug}`}
                className="group flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo hover:shadow-lg hover:shadow-indigo/10"
              >
                <IconTile name={module.icon} />
                <h3 className="text-xl font-bold">{module.name}</h3>
                <p className="leading-relaxed text-slate-text">{module.summary}</p>
                <span className="mt-auto text-sm font-bold text-indigo-ink">Explore →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Band */}
      <section aria-labelledby="band-title" className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 id="band-title" className="text-3xl font-extrabold tracking-tight">
              The numbers are only half the story.
            </h2>
            <p className="mt-3 text-lg text-white/80">
              Code nobody owns, contracts that change hands on a sale, people the business cannot lose. Pactlab finds them before
              they find you.
            </p>
          </div>
          <Link href="/how-it-works" className="inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy hover:bg-white">
            Follow a deal end to end
          </Link>
        </div>
      </section>

      {/* Industries strip */}
      <section aria-labelledby="industries-title" className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 id="industries-title" className="text-center text-sm font-bold uppercase tracking-widest text-slate-text">
            Built for acquirers in
          </h2>
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {INDUSTRIES.map((industry) => (
              <li key={industry.slug}>
                <Link
                  href={`/industries/${industry.slug}`}
                  className="flex h-full flex-col items-center gap-2 rounded-xl border border-navy/10 px-3 py-5 text-center text-sm font-semibold hover:border-indigo hover:bg-mist"
                >
                  <Icon name={industry.icon} className="h-6 w-6 text-indigo-ink" />
                  {industry.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Demos />

      <section id="principles" aria-labelledby="principles-title" className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 id="principles-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {PRINCIPLES.title}
            </h2>
            <p className="mt-4 text-lg text-white/80">{PRINCIPLES.body}</p>
          </div>
          <ul className="flex flex-col gap-4">
            {PRINCIPLES.items.map((item) => (
              <li key={item.title} className="flex gap-4 rounded-xl border border-white/10 bg-white/5 p-5">
                <IconTile name={item.icon} tone="dark" />
                <div>
                  <h3 className="font-bold text-white">{item.title}</h3>
                  <p className="mt-1 leading-relaxed text-white/80">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* From the founder */}
      <section aria-labelledby="founder-title" className="bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 md:grid-cols-[auto_1fr]">
          <span className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-navy text-2xl font-extrabold text-indigo">
            {FOUNDER.initials}
          </span>
          <div className="flex flex-col gap-4">
            <p id="founder-title" className="text-sm font-bold uppercase tracking-widest text-indigo-ink">
              From the founder
            </p>
            <blockquote className="text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">“{FOUNDER.signoff}”</blockquote>
            <p className="text-slate-text">
              {FOUNDER.name}, {FOUNDER.role}
            </p>
            <Link href="/about/vision" className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
              Read the founder’s vision →
            </Link>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section aria-labelledby="closing-title" className="bg-mist">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 id="closing-title" className="text-3xl font-extrabold tracking-tight">
              {CLOSING.title}
            </h2>
            <p className="mt-3 text-lg text-slate-text">{CLOSING.body}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <PrimaryCta />
            <Link href="/pilot" className="font-semibold text-indigo-ink underline-offset-4 hover:underline">
              What a pilot includes →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
