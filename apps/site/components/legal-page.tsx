import { PageHero } from './page-hero';
import { LEGAL_UPDATED, type LegalDocument } from '../lib/legal';

const updated = new Date(`${LEGAL_UPDATED}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** A legal page (privacy policy, terms of service): a short hero, then numbered sections in one readable column. */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <>
      <PageHero eyebrow="Legal" title={document.title} body={document.summary} icon="FileText" />
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm text-slate-text">Last updated {updated}</p>
          <div className="mt-8 flex flex-col gap-10">
            {document.sections.map((section, index) => (
              <section key={section.heading} aria-labelledby={`${document.slug}-${index}`}>
                <h2 id={`${document.slug}-${index}`} className="text-xl font-extrabold tracking-tight text-navy">
                  {index + 1}. {section.heading}
                </h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="mt-3 leading-relaxed text-slate-text">
                    {paragraph}
                  </p>
                ))}
                {section.items ? (
                  <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 leading-relaxed text-slate-text">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
