import type { Metadata } from 'next';
import { CtaBand } from '../../../components/cta';
import { PageHero } from '../../../components/page-hero';
import { NAME_STORY, PILOT } from '../../../lib/content';

export const metadata: Metadata = {
  title: 'The story of the pact',
  description: NAME_STORY.teaser,
};

/** Where the name comes from: the Roman pact, the clasped hands of Fides, and the lab that tests the promise. */
export default function StoryPage() {
  return (
    <>
      <PageHero eyebrow={NAME_STORY.eyebrow} title={NAME_STORY.title} body={NAME_STORY.teaser} icon="Handshake" />
      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 py-20 md:grid-cols-[1fr_1.3fr]">
          <div className="md:sticky md:top-28 md:self-start">
            <img src="/illustrations/fides-coin.svg" alt="A Roman coin showing clasped right hands, the emblem of Fides" width={480} height={480} className="mx-auto h-auto w-full max-w-sm" />
            <p className="mt-6 text-center text-sm text-slate-text">
              Clasped right hands — the Roman sign of good faith, and the handshake inside the Pactlab symbol.
            </p>
          </div>
          <ol className="relative flex flex-col gap-12 border-l-2 border-indigo/30 pl-8">
            {NAME_STORY.chapters.map((chapter, index) => (
              <li key={chapter.title} className="relative">
                <span className="absolute -left-[2.85rem] top-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
                  {['I', 'II', 'III', 'IV'][index]}
                </span>
                <h2 className="text-2xl font-extrabold tracking-tight">{chapter.title}</h2>
                <p className="mt-3 text-lg leading-relaxed text-slate-text">{chapter.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center">
          <img src="/brand/pactlab-symbol.png" alt="" width={512} height={512} className="h-24 w-24 rounded-2xl bg-white p-2" />
          <p className="max-w-2xl text-3xl font-extrabold tracking-tight">{NAME_STORY.closing}</p>
        </div>
      </section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
