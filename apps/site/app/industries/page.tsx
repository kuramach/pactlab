import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '../../components/cta';
import { FeatureGrid } from '../../components/features';
import { IconTile } from '../../components/icon';
import { PageHero, Section } from '../../components/page-hero';
import { StatusBadge } from '../../components/status-badge';
import { INDUSTRY_STORIES } from '../../lib/industry-stories';
import { INDUSTRIES, INDUSTRY_CORE, PILOT } from '../../lib/content';

export const metadata: Metadata = {
  title: 'Industries',
  description: 'Software and SaaS today; fintech, healthcare, telecom and media, services, pharma and biotech, and e-commerce packs to follow.',
};

export default function IndustriesPage() {
  return (
    <>
      <PageHero
        eyebrow="Industries"
        title="The same discipline, applied sector by sector"
        body="Pactlab starts with software and SaaS acquisitions. Each further industry adds the sources, risks and valuation inputs that matter in that sector — on the same core."
      />
      <Section title={INDUSTRY_CORE.title} body={INDUSTRY_CORE.body} tone="mist">
        <FeatureGrid features={INDUSTRY_CORE.parts} />
      </Section>
      <Section title="Where Pactlab works">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((industry) => (
            <li key={industry.slug}>
              <Link
                href={`/industries/${industry.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white transition-colors hover:border-indigo"
              >
                <img src={`/illustrations/${industry.slug}.svg`} alt="" width={640} height={420} loading="lazy" className="h-auto w-full" />
                <div className="flex flex-1 flex-col gap-3 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <IconTile name={industry.icon} />
                    <StatusBadge industry={industry} />
                  </div>
                  <h3 className="text-lg font-bold">{industry.name}</h3>
                  <p className="text-sm font-semibold text-indigo-ink">{INDUSTRY_STORIES[industry.slug]?.headline}</p>
                  <p className="text-sm leading-relaxed text-slate-text">{industry.summary}</p>
                  <span className="mt-auto text-sm font-semibold text-indigo-ink group-hover:underline">See the detail →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
