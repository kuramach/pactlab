import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CtaBand } from '../../../components/cta';
import { PageHero, Section } from '../../../components/page-hero';
import { RelatedLinks } from '../../../components/related-links';
import { FAQS } from '../../../lib/answers';
import { PILOT } from '../../../lib/content';
import { faqPageJsonLd, jsonLdScript, pageMetadata } from '../../../lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return FAQS.map((page) => ({ slug: page.slug }));
}

const find = (slug: string) => FAQS.find((page) => page.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = find((await params).slug);
  return page ? pageMetadata({ title: page.title, description: page.description, path: `/faq/${page.slug}` }) : {};
}

export default async function FaqPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = find((await params).slug);
  if (!page) notFound();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqPageJsonLd(page.items)) }} />
      <PageHero
        eyebrow={`For ${page.audience.toLowerCase()}`}
        title={page.title}
        body={page.description}
        icon="MessageSquareQuote"
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Questions and answers', href: '/faq' },
          { label: page.audience, href: `/faq/${page.slug}` },
        ]}
      />
      <Section title="Questions and answers">
        <div className="flex max-w-3xl flex-col gap-8">
          {page.items.map((item) => (
            <div key={item.q} className="flex flex-col gap-2">
              <h3 className="text-lg font-bold">{item.q}</h3>
              <p className="leading-relaxed text-slate-text">{item.a}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Read next" tone="mist">
        <RelatedLinks links={page.related} />
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
