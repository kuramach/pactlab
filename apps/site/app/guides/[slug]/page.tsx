import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CtaBand } from '../../../components/cta';
import { PageHero, Section } from '../../../components/page-hero';
import { RelatedLinks } from '../../../components/related-links';
import { GUIDES } from '../../../lib/answers';
import { PILOT } from '../../../lib/content';
import { absolute, jsonLdScript, pageMetadata } from '../../../lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

const find = (slug: string) => GUIDES.find((guide) => guide.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = find((await params).slug);
  return guide ? pageMetadata({ title: guide.title, description: guide.description, path: `/guides/${guide.slug}` }) : {};
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = find((await params).slug);
  if (!guide) notFound();
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.description,
    url: absolute(`/guides/${guide.slug}`),
    publisher: { '@type': 'Organization', name: 'Pactlab', url: absolute('/') },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(article) }} />
      <PageHero
        eyebrow="Guide"
        title={guide.title}
        body={guide.intro}
        icon="ListChecks"
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Guides', href: '/guides' },
          { label: guide.title, href: `/guides/${guide.slug}` },
        ]}
      />
      <section className="bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
          {guide.sections.map((section) => (
            <div key={section.heading} className="flex flex-col gap-3">
              <h2 className="text-2xl font-extrabold tracking-tight">{section.heading}</h2>
              {section.body ? <p className="leading-relaxed text-slate-text">{section.body}</p> : null}
              {section.points ? (
                <ul className="flex list-disc flex-col gap-2 pl-5 text-slate-text">
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <Section title="Read next" tone="mist">
        <RelatedLinks links={guide.related} />
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
