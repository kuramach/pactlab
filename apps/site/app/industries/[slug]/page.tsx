import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CtaBand, PilotButton, SignUpLink } from '../../../components/cta';
import { FeatureGrid } from '../../../components/features';
import { Icon, IconTile } from '../../../components/icon';
import { Section } from '../../../components/page-hero';
import { StatusBadge } from '../../../components/status-badge';
import { FLOW, INDUSTRIES, PILOT, PLANNED_NOTE } from '../../../lib/content';
import { INDUSTRY_STORIES } from '../../../lib/industry-stories';

export const dynamicParams = false;

export function generateStaticParams() {
  return INDUSTRIES.map((industry) => ({ slug: industry.slug }));
}

const find = (slug: string) => INDUSTRIES.find((industry) => industry.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const industry = find((await params).slug);
  const story = industry ? INDUSTRY_STORIES[industry.slug] : undefined;
  return industry && story
    ? {
        title: `${industry.name} M&A diligence`,
        description: story.subhead,
        openGraph: { images: [{ url: `/illustrations/${industry.slug}.svg`, alt: story.illustrationAlt }] },
      }
    : {};
}

const stepIcon = (step: string) => FLOW.find((entry) => entry.step === step)?.icon ?? 'Database';

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const industry = find((await params).slug);
  const story = industry ? INDUSTRY_STORIES[industry.slug] : undefined;
  if (!industry || !story) notFound();
  const planned = industry.status === 'PLANNED';
  const others = INDUSTRIES.filter((other) => other.slug !== industry.slug);

  return (
    <>
      {/* Hero: headline and illustration */}
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-[1.15fr_1fr] md:py-20">
          <div className="flex flex-col gap-6">
            <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-indigo">
              <Icon name={industry.icon} className="h-4 w-4" />
              {industry.name} M&amp;A
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight md:text-5xl">{story.headline}</h1>
            <p className="max-w-xl text-lg leading-relaxed text-white/85">{story.subhead}</p>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge industry={industry} tone="dark" />
              {planned ? <p className="max-w-md text-sm text-white/70">{PLANNED_NOTE}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <PilotButton label={planned ? 'Become a design partner' : 'Request a pilot'} />
              {planned ? null : <SignUpLink tone="dark" />}
            </div>
          </div>
          <div className="rounded-3xl bg-white p-3 shadow-2xl shadow-black/30">
            <img
              src={`/illustrations/${industry.slug}.svg`}
              alt={story.illustrationAlt}
              width={640}
              height={420}
              className="h-auto w-full rounded-2xl"
            />
          </div>
        </div>
      </section>

      {/* The problem */}
      <Section title="Where these deals go wrong" body={industry.dealShape}>
        <FeatureGrid features={story.pains} />
      </Section>

      <Section title="The questions that decide the deal" tone="mist">
        <ul className="grid gap-3 md:grid-cols-2">
          {industry.questions.map((question) => (
            <li key={question} className="flex items-start gap-3 rounded-xl bg-white p-5">
              <span className="mt-0.5 text-indigo-ink">
                <Icon name="FileSearch" />
              </span>
              <span className="font-semibold">{question}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* How a deal runs */}
      <Section
        title={planned ? `How a ${industry.name.toLowerCase()} deal would run` : 'How a deal runs with Pactlab'}
        body={
          planned
            ? 'An illustrative walk through the decision loop once the pack is built.'
            : 'An illustrative walk through the decision loop on a software acquisition.'
        }
        tone="navy"
      >
        <ol className="relative flex flex-col gap-6 border-l border-white/15 pl-8">
          {story.walkthrough.map((entry, index) => (
            <li key={entry.step} className="relative">
              <span className="absolute -left-[3.05rem] top-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo text-navy">
                <Icon name={stepIcon(entry.step)} className="h-5 w-5" />
              </span>
              <p className="text-xs font-bold uppercase tracking-widest text-indigo">
                {String(index + 1).padStart(2, '0')} · {entry.step}
              </p>
              <p className="mt-1 max-w-3xl text-lg leading-relaxed text-white/90">{entry.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Example findings */}
      <Section
        title="What it finds — and what that becomes in the deal"
        body="Illustrative examples of findings and the terms they turn into. Every real finding carries citations and a named reviewer."
      >
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {story.findings.map((finding) => (
            <li key={finding.title} className="flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    finding.severity === 'High' ? 'bg-navy text-white' : 'bg-indigo/15 text-indigo-ink'
                  }`}
                >
                  {finding.severity} severity
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-text">Example</span>
              </div>
              <h3 className="text-lg font-bold leading-snug">{finding.title}</h3>
              <p className="flex items-start gap-2 text-sm text-slate-text">
                <Icon name="Link2" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-ink" />
                {finding.evidence}
              </p>
              <p className="mt-auto flex items-start gap-2 rounded-xl bg-mist p-3 text-sm font-semibold">
                <Icon name="Handshake" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-ink" />
                {finding.term}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      {industry.vocabulary ? (
        <Section title="Their language, the same engine" body="Sector metrics map directly onto concepts Pactlab already computes." tone="mist">
          <table className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white text-left">
            <thead className="bg-navy text-white">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">In {industry.name.toLowerCase()}</th>
                <th scope="col" className="px-5 py-3 font-bold">In Pactlab</th>
              </tr>
            </thead>
            <tbody>
              {industry.vocabulary.map((row) => (
                <tr key={row.theirs} className="border-t border-navy/10">
                  <td className="px-5 py-3 font-semibold">{row.theirs}</td>
                  <td className="px-5 py-3 text-slate-text">{row.ours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {/* Coverage */}
      <Section
        title={planned ? 'What carries over from the core' : 'What Pactlab covers'}
        body={planned ? 'These parts of Pactlab apply to the sector as they are.' : 'The modules available today.'}
        tone={industry.vocabulary ? 'white' : 'mist'}
      >
        <FeatureGrid features={industry.transfers} columns={industry.transfers.length === 4 ? 2 : 3} />
      </Section>

      {industry.adds.length > 0 ? (
        <Section title="What the industry pack adds" body="New sources, finding types and valuation inputs — plugged into the unchanged core." tone="navy">
          <FeatureGrid features={industry.adds} columns={industry.adds.length === 4 ? 2 : 3} tone="dark" />
        </Section>
      ) : null}

      <Section title="What you walk away with" tone="cloud">
        <FeatureGrid features={story.deliverables} />
      </Section>

      {/* FAQ */}
      <Section title="Questions buyers ask">
        <div className="flex max-w-3xl flex-col divide-y divide-navy/10 rounded-2xl border border-navy/10">
          {story.faq.map((item) => (
            <details key={item.q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold">
                {item.q}
                <span aria-hidden className="text-indigo-ink transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-slate-text">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Other industries */}
      <Section title="Other industries" tone="mist">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((other) => (
            <li key={other.slug}>
              <Link
                href={`/industries/${other.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white transition-colors hover:border-indigo"
              >
                <img src={`/illustrations/${other.slug}.svg`} alt="" width={640} height={420} loading="lazy" className="h-auto w-full" />
                <div className="flex items-center justify-between gap-3 p-4">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <IconTile name={other.icon} />
                    {other.name}
                  </span>
                  <StatusBadge industry={other} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <CtaBand
        title={planned ? `Buying in ${industry.name.toLowerCase()}?` : PILOT.title}
        body={planned ? 'Design partners in this sector help decide what the pack reads and checks first. Talk to us.' : PILOT.body}
        {...(planned ? { label: 'Talk to us' } : {})}
      />
    </>
  );
}
