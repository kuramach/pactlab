import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CtaBand, SignUpLink } from '../../../components/cta';
import { IconTile } from '../../../components/icon';
import { PageHero, Section } from '../../../components/page-hero';
import { PILOT } from '../../../lib/content';
import { pageMetadata } from '../../../lib/seo';
import { findTryPack, TRY_PACKS, trySteps } from '../../../lib/try';

export const dynamicParams = false;

export function generateStaticParams() {
  return TRY_PACKS.map((pack) => ({ slug: pack.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const pack = findTryPack((await params).slug);
  return pack ? pageMetadata({ title: `Try a ${pack.name} pact`, description: `Download a synthetic ${pack.name} data room and run it through Pactlab, step by step.`, path: `/try/${pack.slug}` }) : {};
}

const download = 'inline-flex items-center rounded-lg border border-navy/25 px-4 py-2 text-sm font-bold text-navy hover:border-navy';

export default async function TryPackPage({ params }: { params: Promise<{ slug: string }> }) {
  const pack = findTryPack((await params).slug);
  if (!pack) notFound();
  const steps = trySteps(pack);
  return (
    <>
      <PageHero
        eyebrow="Try it"
        title={`A ${pack.name} pact, on synthetic data`}
        body="Download a fictional company’s data room and extracts, then follow the steps. Each step says where to click and what you will see."
        icon="Database"
        crumbs={[
          { label: 'Try it', href: '/try' },
          { label: pack.name, href: `/try/${pack.slug}` },
        ]}
      >
        <div className="flex flex-wrap gap-4">
          <SignUpLink tone="dark" />
        </div>
      </PageHero>
      <Section title="The files" body="Synthetic: every company, person and figure is invented. Nothing here is a customer’s.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <a href={pack.dataRoomUrl} className={download} download>
              Data room (zip)
            </a>
            {pack.extracts.map((extract) => (
              <a key={extract.fileName} href={extract.url} className={download} download>
                {extract.label} ({extract.fileName})
              </a>
            ))}
          </div>
          <a href={pack.folderUrl} className="text-sm font-semibold text-indigo-ink underline-offset-4 hover:underline">
            Browse every file on GitHub →
          </a>
        </div>
      </Section>
      <Section title="Step by step" tone="mist">
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-2xl border border-navy/10 bg-white p-6">
              <IconTile name={step.icon} />
              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-ink">
                  Step {index + 1} · {step.where}
                </p>
                <h3 className="text-lg font-extrabold text-navy">{step.title}</h3>
                <ul className="list-disc pl-5 text-sm text-slate-text">
                  {step.do.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-sm">
                  <span className="font-semibold">You will see: </span>
                  {step.see}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
