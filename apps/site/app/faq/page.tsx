import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '../../components/cta';
import { PageHero, Section } from '../../components/page-hero';
import { FAQS } from '../../lib/answers';
import { PILOT } from '../../lib/content';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Questions and answers',
  description: 'Answers for acquirers, founders preparing a raise, and deal advisors: how Pactlab’s evidence-first diligence works and where people decide.',
  path: '/faq',
});

export default function FaqIndexPage() {
  return (
    <>
      <PageHero
        eyebrow="Questions and answers"
        title="Questions about Pactlab, by who is asking"
        body="Acquirers, founders and advisors ask different questions. Each page answers one audience in plain terms."
        icon="MessageSquareQuote"
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Questions and answers', href: '/faq' },
        ]}
      />
      <Section title="Choose your side of the deal">
        <ul className="grid gap-4 md:grid-cols-3">
          {FAQS.map((page) => (
            <li key={page.slug}>
              <Link href={`/faq/${page.slug}`} className="flex h-full flex-col gap-2 rounded-2xl border border-navy/10 p-6 hover:border-indigo hover:bg-mist">
                <span className="text-sm font-bold uppercase tracking-widest text-indigo-ink">{page.audience}</span>
                <span className="text-lg font-bold">{page.title}</span>
                <span className="text-sm text-slate-text">{page.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
