import type { Metadata } from 'next';
import Link from 'next/link';
import { IconTile } from '../../components/icon';
import { PageHero } from '../../components/page-hero';
import { ABOUT_PAGES, NAME_STORY } from '../../lib/content';

export const metadata: Metadata = { title: 'About', description: NAME_STORY.teaser };

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About Pactlab" title={NAME_STORY.title} body={NAME_STORY.teaser} icon="Handshake" />
      <section className="bg-mist">
        <ul className="mx-auto grid max-w-6xl gap-5 px-6 py-20 md:grid-cols-3">
          {ABOUT_PAGES.map((page) => (
            <li key={page.href}>
              <Link
                href={page.href}
                className="flex h-full flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-7 transition hover:-translate-y-0.5 hover:border-indigo hover:shadow-lg hover:shadow-indigo/10"
              >
                <IconTile name={page.icon} />
                <h2 className="text-xl font-bold">{page.label}</h2>
                <p className="text-slate-text">{page.detail}</p>
                <span className="mt-auto text-sm font-bold text-indigo-ink">Read →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
