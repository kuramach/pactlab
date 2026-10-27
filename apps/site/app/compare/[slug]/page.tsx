import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CtaBand } from '../../../components/cta';
import { PageHero, Section } from '../../../components/page-hero';
import { RelatedLinks } from '../../../components/related-links';
import { COMPARISONS } from '../../../lib/answers';
import { PILOT } from '../../../lib/content';
import { pageMetadata } from '../../../lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPARISONS.map((comparison) => ({ slug: comparison.slug }));
}

const find = (slug: string) => COMPARISONS.find((comparison) => comparison.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const comparison = find((await params).slug);
  return comparison ? pageMetadata({ title: comparison.title, description: comparison.description, path: `/compare/${comparison.slug}` }) : {};
}

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const comparison = find((await params).slug);
  if (!comparison) notFound();
  return (
    <>
      <PageHero
        eyebrow="Comparison"
        title={comparison.title}
        body={comparison.intro}
        icon="Scale"
        crumbs={[
          { label: 'Home', href: '/' },
          { label: comparison.title, href: `/compare/${comparison.slug}` },
        ]}
      />
      <Section title={`Pactlab and ${comparison.them}, side by side`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-navy/20">
                <th scope="col" className="py-3 pr-4 font-bold">
                  Topic
                </th>
                <th scope="col" className="py-3 pr-4 font-bold">
                  {comparison.them}
                </th>
                <th scope="col" className="py-3 font-bold">
                  Pactlab
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.topic} className="border-b border-navy/10 align-top">
                  <th scope="row" className="py-3 pr-4 font-semibold">
                    {row.topic}
                  </th>
                  <td className="py-3 pr-4 text-slate-text">{row.them}</td>
                  <td className="py-3 text-slate-text">{row.pactlab}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-8 max-w-3xl text-lg leading-relaxed">{comparison.conclusion}</p>
        <p className="mt-6 text-sm text-slate-text">
          What we say about {comparison.them} comes from its public pages:{' '}
          {comparison.sources.map((source) => (
            <a key={source.href} href={source.href} rel="noopener" className="underline underline-offset-4">
              {source.label}
            </a>
          ))}
          . Checked October 2026.
        </p>
      </Section>
      <Section title="Read next" tone="mist">
        <RelatedLinks
          links={[
            { href: '/how-it-works', label: 'How Pactlab works' },
            { href: '/product/valuation', label: 'Sextant: valuation and deal terms' },
            { href: '/faq/advisors', label: 'Questions from deal advisors' },
          ]}
        />
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
