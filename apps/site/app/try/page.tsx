import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '../../components/icon';
import { PageHero, Section } from '../../components/page-hero';
import { TRY_PACKS } from '../../lib/try';
import { pageMetadata } from '../../lib/seo';

const DESCRIPTION = 'Pick a pact, download its synthetic data room and extracts, and follow the steps: Pactlab finds the planted problems and prices them, end to end.';

export const metadata: Metadata = pageMetadata({ title: 'Try it with synthetic data', description: DESCRIPTION, path: '/try' });

export default function TryPage() {
  return (
    <>
      <PageHero eyebrow="Try it" title="Run a pact on synthetic data" body={DESCRIPTION} icon="Database" />
      <Section title="Pick a pact" body="Each comes with a fictional company’s data room and system extracts. Every name and figure is invented.">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRY_PACKS.map((pack) => (
            <li key={pack.slug}>
              <Link href={`/try/${pack.slug}`} className="flex h-full flex-col gap-2 rounded-2xl border border-navy/10 bg-white p-6 hover:border-indigo">
                <span className="text-lg font-extrabold text-navy">{pack.name}</span>
                <span className="text-sm text-slate-text">
                  A data room and {pack.extracts.length} extract{pack.extracts.length === 1 ? '' : 's'}, step by step.
                </span>
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-indigo-ink">
                  Walk me through it <Icon name="ArrowLeftRight" className="h-4 w-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
