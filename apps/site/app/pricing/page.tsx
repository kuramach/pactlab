import type { Metadata } from 'next';
import { CtaBand, PilotButton, SignUpLink } from '../../components/cta';
import { FeatureGrid } from '../../components/features';
import { Icon, IconTile } from '../../components/icon';
import { PageHero, Section } from '../../components/page-hero';
import { siteConfig } from '../../lib/config';
import { PILOT, PLANS, PRICING } from '../../lib/content';
import { jsonLdScript, offerCatalogJsonLd, pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({ title: 'Pricing', description: PRICING.body, path: '/pricing' });

export default function PricingPage() {
  const { contactHref } = siteConfig();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(offerCatalogJsonLd()) }} />
      <PageHero eyebrow="Pricing" title={PRICING.title} body={PRICING.body} icon="Receipt">
        <div className="flex flex-wrap gap-4">
          <SignUpLink tone="dark" />
          <PilotButton />
        </div>
      </PageHero>
      <Section title="Plans">
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <li
              key={plan.id}
              className={`flex flex-col gap-5 rounded-2xl p-6 ${plan.highlighted ? 'border-2 border-indigo bg-white shadow-lg' : 'border border-navy/10 bg-white'}`}
            >
              <div className="flex items-center gap-3">
                <IconTile name={plan.icon} />
                <div>
                  <h3 className="text-lg font-extrabold text-navy">{plan.name}</h3>
                  <p className="text-sm text-slate-text">{plan.audience}</p>
                </div>
              </div>
              <div>
                {plan.price ? (
                  <p className="text-4xl font-extrabold tracking-tight text-navy">{plan.price}</p>
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight text-navy">Talk to us</p>
                )}
                {plan.price ? <p className="text-sm text-slate-text">{plan.cadence}</p> : null}
                {plan.alternatives.length > 0 ? <p className="mt-1 text-sm text-slate-text">or {plan.alternatives.join(' · ')}</p> : null}
              </div>
              <ul className="flex flex-col gap-2 text-sm">
                {plan.includes.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span className="mt-0.5 text-indigo-ink">
                      <Icon name="BadgeCheck" className="h-4 w-4" />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              {plan.price === null && contactHref ? (
                <a href={contactHref} className="mt-auto font-semibold text-indigo-ink underline-offset-4 hover:underline">
                  Talk to us →
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="What every plan includes" tone="mist">
        <FeatureGrid features={PRICING.notes} />
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
