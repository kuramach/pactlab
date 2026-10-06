import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CtaBand } from '../../../components/cta';
import { FeatureGrid } from '../../../components/features';
import { Flow } from '../../../components/flow';
import { IconTile } from '../../../components/icon';
import { PageHero, Section } from '../../../components/page-hero';
import { MODULES, PILOT } from '../../../lib/content';

/** Where each module sits in the decision loop. */
const FLOW_STEPS: Readonly<Record<string, readonly string[]>> = {
  revenue: ['Evidence', 'Finding'],
  technology: ['Evidence', 'Finding'],
  delivery: ['Evidence', 'Finding'],
  documents: ['Evidence', 'Finding'],
  findings: ['Finding', 'Review', 'Assumption'],
  valuation: ['Assumption', 'Valuation', 'Deal terms'],
};

export const dynamicParams = false;

export function generateStaticParams() {
  return MODULES.map((module) => ({ slug: module.slug }));
}

const find = (slug: string) => MODULES.find((module) => module.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const module = find((await params).slug);
  return module ? { title: module.name, description: module.summary } : {};
}

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const module = find((await params).slug);
  if (!module) notFound();
  const others = MODULES.filter((other) => other.slug !== module.slug);
  return (
    <>
      <PageHero eyebrow={module.name} title={module.question} body={module.intro} icon={module.icon} />
      <Section title="What it does">
        <FeatureGrid features={module.features} />
      </Section>
      <Section title="What the reviewer gets" tone="mist">
        <p className="max-w-3xl rounded-2xl border-l-4 border-indigo bg-white p-6 text-lg font-semibold">{module.output}</p>
      </Section>
      <Section title="Where it sits in the loop" tone="navy">
        <Flow tone="dark" highlight={FLOW_STEPS[module.slug] ?? []} />
      </Section>
      <Section title="Other modules">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {others.map((other) => (
            <li key={other.slug}>
              <Link href={`/product/${other.slug}`} className="flex h-full flex-col gap-3 rounded-xl border border-navy/10 p-4 hover:border-indigo">
                <IconTile name={other.icon} />
                <span className="text-sm font-semibold">{other.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
