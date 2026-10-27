import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '../../components/cta';
import { PageHero, Section } from '../../components/page-hero';
import { GUIDES } from '../../lib/answers';
import { PILOT } from '../../lib/content';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Diligence guides',
  description: 'Practical guides to SaaS acquisition due diligence, technical due diligence with AI, and preparing a startup for investor diligence.',
  path: '/guides',
});

export default function GuidesIndexPage() {
  return (
    <>
      <PageHero
        eyebrow="Guides"
        title="Diligence guides"
        body="Checklists for the questions deal teams and founders actually ask, with Pactlab as the worked example."
        icon="ListChecks"
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Guides', href: '/guides' },
        ]}
      />
      <Section title="All guides">
        <ul className="grid gap-4 md:grid-cols-3">
          {GUIDES.map((guide) => (
            <li key={guide.slug}>
              <Link href={`/guides/${guide.slug}`} className="flex h-full flex-col gap-2 rounded-2xl border border-navy/10 p-6 hover:border-indigo hover:bg-mist">
                <span className="text-lg font-bold">{guide.title}</span>
                <span className="text-sm text-slate-text">{guide.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
