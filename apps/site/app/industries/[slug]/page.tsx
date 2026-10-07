import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CtaBand } from '../../../components/cta';
import { FeatureGrid } from '../../../components/features';
import { Flow } from '../../../components/flow';
import { Icon } from '../../../components/icon';
import { PageHero, Section } from '../../../components/page-hero';
import { StatusBadge } from '../../../components/status-badge';
import { INDUSTRIES, PILOT, PLANNED_NOTE } from '../../../lib/content';

export const dynamicParams = false;

export function generateStaticParams() {
  return INDUSTRIES.map((industry) => ({ slug: industry.slug }));
}

const find = (slug: string) => INDUSTRIES.find((industry) => industry.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const industry = find((await params).slug);
  return industry ? { title: `${industry.name} M&A diligence`, description: industry.summary } : {};
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const industry = find((await params).slug);
  if (!industry) notFound();
  const planned = industry.status === 'PLANNED';
  return (
    <>
      <PageHero eyebrow={`${industry.name} M&A`} title={industry.summary} body={industry.dealShape} icon={industry.icon}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge industry={industry} tone="dark" />
          {planned ? <p className="max-w-xl text-sm text-white/75">{PLANNED_NOTE}</p> : null}
        </div>
      </PageHero>

      <Section title="The questions that decide the deal">
        <ul className="grid gap-3 md:grid-cols-2">
          {industry.questions.map((question) => (
            <li key={question} className="flex items-start gap-3 rounded-xl bg-cloud p-5">
              <span className="mt-0.5 text-indigo-ink">
                <Icon name="FileSearch" />
              </span>
              <span className="font-semibold">{question}</span>
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
      ) : (
        <Section title="The decision loop" tone="navy">
          <Flow tone="dark" />
        </Section>
      )}

      <Section title="Other industries">
        <ul className="flex flex-wrap gap-3">
          {INDUSTRIES.filter((other) => other.slug !== industry.slug).map((other) => (
            <li key={other.slug}>
              <Link href={`/industries/${other.slug}`} className="inline-flex items-center gap-2 rounded-full border border-navy/15 px-4 py-2 text-sm font-semibold hover:border-indigo">
                <Icon name={other.icon} className="h-4 w-4 text-indigo-ink" />
                {other.name}
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
