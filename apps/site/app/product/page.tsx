import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '../../components/cta';
import { Icon, IconTile } from '../../components/icon';
import { PageHero, Section } from '../../components/page-hero';
import { MODULES, PILOT } from '../../lib/content';

export const metadata: Metadata = { title: 'Product', description: 'Six modules, one decision loop: revenue, technology, delivery, documents, findings and valuation.' };

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="Six modules. One decision loop."
        body="Each module answers a question a deal team has to answer before signing — and hands its answer to the next step with the evidence attached."
      />
      {MODULES.map((module, index) => (
        <Section key={module.slug} title={module.name} body={module.intro} tone={index % 2 === 0 ? 'white' : 'mist'}>
          <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-4">
              <IconTile name={module.icon} />
              <p className="text-xl font-bold italic text-indigo-ink">“{module.question}”</p>
              <Link href={`/product/${module.slug}`} className="font-semibold text-indigo-ink hover:underline">
                Read more →
              </Link>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {module.features.map((feature) => (
                <li key={feature.title} className="flex items-start gap-3">
                  <span className="mt-0.5 text-indigo-ink">
                    <Icon name={feature.icon} />
                  </span>
                  <span>
                    <span className="font-semibold">{feature.title}.</span>{' '}
                    <span className="text-slate-text">{feature.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ))}
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
