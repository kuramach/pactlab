import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CtaBand } from '../../../components/cta';
import { PageHero, Section } from '../../../components/page-hero';
import { CASE_STUDIES, type CitedFact } from '../../../lib/cases';
import { PILOT } from '../../../lib/content';
import { absolute, jsonLdScript, pageMetadata } from '../../../lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return CASE_STUDIES.map((study) => ({ slug: study.slug }));
}

const find = (slug: string) => CASE_STUDIES.find((study) => study.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const study = find((await params).slug);
  return study ? pageMetadata({ title: study.title, description: study.description, path: `/case-studies/${study.slug}` }) : {};
}

/** A cited sentence: superscript links to the numbered sources below. */
function Fact({ fact }: { fact: CitedFact }) {
  return (
    <p className="leading-relaxed text-slate-text">
      {fact.text}
      {fact.sources.map((id) => (
        <sup key={id} className="ml-0.5">
          <a href={`#source-${id}`} className="font-bold text-indigo hover:underline">
            [{id}]
          </a>
        </sup>
      ))}
    </p>
  );
}

export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const study = find((await params).slug);
  if (!study) notFound();
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: study.title,
    description: study.description,
    url: absolute(`/case-studies/${study.slug}`),
    publisher: { '@type': 'Organization', name: 'Pactlab', url: absolute('/') },
    citation: study.sources.map((source) => ({ '@type': 'CreativeWork', name: source.title, publisher: source.publisher, url: source.url })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(article) }} />
      <PageHero
        eyebrow={`Case study ${study.number}`}
        title={study.title}
        body={study.line}
        icon="ListChecks"
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Case studies', href: '/case-studies' },
          { label: study.title, href: `/case-studies/${study.slug}` },
        ]}
      />
      <section className="bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
          <h2 className="text-2xl font-extrabold tracking-tight">The deal</h2>
          {study.deal.map((fact) => (
            <Fact key={fact.text} fact={fact} />
          ))}
        </div>
      </section>
      <Section
        title="What failed, and the check built for it"
        body="Each defect from the record, beside the Pactlab check designed for that failure mode. The mapping describes what Pactlab is built to do; Pactlab played no part in this deal and this page makes no claim about how it would have ended."
        tone="mist"
      >
        <ol className="mt-8 flex flex-col gap-6">
          {study.defects.map((defect, index) => (
            <li key={defect.name} className="grid gap-6 rounded-2xl border border-navy/10 bg-white p-6 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-bold uppercase tracking-widest text-slate-text">Defect {index + 1}</span>
                <h3 className="text-lg font-bold">{defect.name}</h3>
                <Fact fact={defect.record} />
              </div>
              <div className="flex flex-col gap-2 border-navy/10 md:border-l md:pl-6">
                <span className="text-sm font-bold uppercase tracking-widest text-slate-text">{defect.phase}</span>
                <h3 className="text-lg font-bold">
                  <Link href={defect.href} className="hover:text-indigo">
                    {defect.check}
                  </Link>
                </h3>
                <p className="leading-relaxed text-slate-text">{defect.how}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <section className="bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
          <h2 className="text-2xl font-extrabold tracking-tight">Where it stands</h2>
          <p className="text-sm font-bold uppercase tracking-widest text-slate-text">Status as of {study.status.asOf}</p>
          {study.status.facts.map((fact) => (
            <Fact key={fact.text} fact={fact} />
          ))}
          <h2 className="mt-8 text-2xl font-extrabold tracking-tight">Run the case</h2>
          <p className="leading-relaxed text-slate-text">
            The synthetic dataset <em>{study.dataset.name}</em> rebuilds the same failure modes with invented companies, sites and figures, and a fixed findings key. Seed it into a Pactlab demo
            organization or read it on{' '}
            <a href={study.dataset.href} className="font-bold text-indigo hover:underline">
              GitHub
            </a>
            .
          </p>
          <h2 className="mt-8 text-2xl font-extrabold tracking-tight">Sources</h2>
          <ol className="flex flex-col gap-2 text-sm text-slate-text">
            {study.sources.map((source) => (
              <li key={source.id} id={`source-${source.id}`}>
                [{source.id}]{' '}
                <a href={source.url} rel="noopener" className="font-bold text-navy hover:text-indigo hover:underline">
                  {source.title}
                </a>
                , {source.publisher}, {source.date}.
              </li>
            ))}
          </ol>
        </div>
      </section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
