import Link from 'next/link';
import { CtaBand, PilotButton, SignUpLink } from '../components/cta';
import { FeatureGrid } from '../components/features';
import { Flow } from '../components/flow';
import { Icon, IconTile } from '../components/icon';
import { Section } from '../components/page-hero';
import { BRAND_LINE, HOME, INDUSTRIES, MODULES, PILOT, PRINCIPLES, SOURCES, STORY } from '../lib/content';

export default function HomePage() {
  return (
    <>
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-14 md:grid-cols-[1.4fr_1fr] md:pt-20">
          <div className="flex flex-col gap-6">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo">{HOME.eyebrow}</p>
            <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl">{HOME.title}</h1>
            <p className="max-w-xl text-lg leading-relaxed text-white/85">{HOME.body}</p>
            <div className="flex flex-wrap items-center gap-4">
              <PilotButton />
              <SignUpLink tone="dark" />
              <Link href="/how-it-works" className="font-semibold text-white underline-offset-4 hover:underline">
                See how it works →
              </Link>
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-4">
            <div className="rounded-3xl bg-white p-8 shadow-2xl shadow-black/30">
              <img src="/brand/pactlab-symbol.png" alt="" width={512} height={512} className="h-auto w-full" />
            </div>
            <p className="text-center text-sm font-semibold text-white/80">{BRAND_LINE}</p>
          </div>
        </div>
      </section>

      <Section title="From evidence to deal terms, without losing the thread" body="Each step keeps its link to the one before, so a term in the purchase agreement traces back to the record that justified it." tone="mist">
        <Flow />
      </Section>

      <Section title="What Pactlab does" body="Six modules, one decision loop.">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((module) => (
            <li key={module.slug}>
              <Link
                href={`/product/${module.slug}`}
                className="group flex h-full flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-6 transition-colors hover:border-indigo"
              >
                <IconTile name={module.icon} />
                <div>
                  <h3 className="text-lg font-bold">{module.name}</h3>
                  <p className="mt-1 text-sm italic text-indigo-ink">{module.question}</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-text">{module.summary}</p>
                </div>
                <span className="mt-auto text-sm font-semibold text-indigo-ink group-hover:underline">Explore →</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={PRINCIPLES.title} body={`${PRINCIPLES.body} ${STORY}`} tone="navy">
        <FeatureGrid features={PRINCIPLES.items} columns={2} tone="dark" />
      </Section>

      <Section title={SOURCES.title} body={SOURCES.body} tone="cloud">
        <FeatureGrid features={SOURCES.items} />
      </Section>

      <Section title="Industries" body="Software and SaaS today. Industry packs follow once the software baseline is proven in pilot.">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {INDUSTRIES.map((industry) => (
            <li key={industry.slug}>
              <Link
                href={`/industries/${industry.slug}`}
                className="flex items-center gap-3 rounded-xl border border-navy/10 p-4 hover:border-indigo"
              >
                <Icon name={industry.icon} className="h-5 w-5 text-indigo-ink" />
                <span className="font-semibold">{industry.name}</span>
                <span className="ml-auto text-xs font-semibold text-slate-text">{industry.status === 'AVAILABLE' ? 'Available' : 'Planned'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
