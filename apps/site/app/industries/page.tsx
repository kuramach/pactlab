import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '../../components/cta';
import { FeatureGrid } from '../../components/features';
import { IconTile } from '../../components/icon';
import { PageHero, Section } from '../../components/page-hero';
import { StatusBadge } from '../../components/status-badge';
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
                className="group flex h-full flex-col gap-4 rounded-2xl border border-navy/10 p-6 transition-colors hover:border-indigo"
              >
                <div className="flex items-start justify-between gap-3">
                  <IconTile name={industry.icon} />
                  <StatusBadge industry={industry} />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{industry.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-text">{industry.summary}</p>
                </div>
                <span className="mt-auto text-sm font-semibold text-indigo-ink group-hover:underline">See the detail →</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
