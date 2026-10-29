import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '../../components/cta';
import { PageHero, Section } from '../../components/page-hero';
import { CASE_STUDIES } from '../../lib/cases';
import { PILOT } from '../../lib/content';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Failed-deal case studies',
  description: 'Real mergers that failed, told from court rulings and regulator filings with every fact cited, and the Pactlab checks built for each failure mode.',
  path: '/case-studies',
});

export default function CaseStudiesIndexPage() {
  return (
    <>
      <PageHero
        eyebrow="Case studies"
        title="Failed-deal case studies"
        body="Real deals that failed, told from the record with every fact cited, mapped defect by defect to the checks Pactlab is built to run. Each comes with a synthetic dataset you can run yourself."
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
                <span className="text-sm font-bold uppercase tracking-widest text-slate-text">Case {study.number}</span>
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
