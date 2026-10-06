import type { Metadata } from 'next';
import { PilotButton, SignUpLink } from '../../components/cta';
import { FeatureGrid } from '../../components/features';
import { PageHero, Section } from '../../components/page-hero';
import { siteConfig } from '../../lib/config';
import { PILOT } from '../../lib/content';

export const metadata: Metadata = { title: 'Pilot', description: PILOT.body };

export default function PilotPage() {
  const { contactHref } = siteConfig();
  return (
    <>
      <PageHero eyebrow="Pilot" title={PILOT.title} body={PILOT.body} icon="Handshake">
        <div className="flex flex-wrap gap-4">
          <PilotButton />
          <SignUpLink tone="dark" />
        </div>
      </PageHero>
      <Section title="What a pilot includes">
        <FeatureGrid features={PILOT.includes} columns={2} />
      </Section>
      {!contactHref ? (
        <Section title="Get in touch" tone="mist">
          <p className="text-lg text-slate-text">Contact details will be published here shortly.</p>
        </Section>
      ) : null}
    </>
  );
}
