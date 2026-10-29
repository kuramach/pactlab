import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '../../components/cta';
import { PageHero, Section } from '../../components/page-hero';
import { CASE_STUDIES } from '../../lib/cases';
import { PILOT } from '../../lib/content';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Case studies: what pact outcomes teach',
  description: 'What Pactlab learns from good and bad pact outcomes — real deals told from the record with every fact cited — and how each lesson becomes a check that protects future pacts.',
  path: '/case-studies',
});

export default function CaseStudiesIndexPage() {
  return (
    <>
      <PageHero
        eyebrow="Case studies"
        title="What pact outcomes teach"
        body="Pactlab learns from how pacts turn out, good and bad. Each case study tells a real deal from the public record, every fact cited, names the lessons, and shows the check Pactlab now runs so future pacts are protected. Each comes with a synthetic dataset you can run yourself."
        icon="ListChecks"
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Case studies', href: '/case-studies' },
        ]}
      />
      <Section title="All case studies">
        <ul className="grid gap-4 md:grid-cols-2">
          {CASE_STUDIES.map((study) => (
            <li key={study.slug}>
              <Link href={`/case-studies/${study.slug}`} className="flex h-full flex-col gap-2 rounded-2xl border border-navy/10 p-6 hover:border-indigo hover:bg-mist">
                <span className="text-sm font-bold uppercase tracking-widest text-slate-text">
                  Case {study.number} · {study.outcome.label}
                </span>
                <span className="text-lg font-bold">{study.title}</span>
                <span className="text-sm text-slate-text">{study.line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
