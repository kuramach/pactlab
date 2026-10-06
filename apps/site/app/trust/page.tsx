import type { Metadata } from 'next';
import { CtaBand } from '../../components/cta';
import { FeatureGrid } from '../../components/features';
import { PageHero, Section } from '../../components/page-hero';
import { PILOT, PRINCIPLES, TRUST } from '../../lib/content';

export const metadata: Metadata = { title: 'Trust', description: TRUST.intro };

export default function TrustPage() {
  return (
    <>
      <PageHero eyebrow="Trust" title={TRUST.title} body={TRUST.intro} icon="Lock" />
      <Section title="Controls enforced where they cannot be bypassed">
        <FeatureGrid features={TRUST.items} />
      </Section>
      <Section title={PRINCIPLES.title} body={PRINCIPLES.body} tone="navy">
        <FeatureGrid features={PRINCIPLES.items} columns={2} tone="dark" />
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
