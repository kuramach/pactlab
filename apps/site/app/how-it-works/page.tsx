import type { Metadata } from 'next';
import { CtaBand } from '../../components/cta';
import { FeatureGrid } from '../../components/features';
import { Flow } from '../../components/flow';
import { PageHero, Section } from '../../components/page-hero';
import { PILOT, PRINCIPLES, SOURCES } from '../../lib/content';

export const metadata: Metadata = { title: 'How it works', description: 'From source evidence to deal terms, with a person deciding at every step that matters.' };

const OUTPUTS = [
  { icon: 'ArrowLeftRight', title: 'Reconciled revenue', body: 'An approved bridge from reported to billed ARR.' },
  { icon: 'ClipboardList', title: 'A risk register', body: 'Accepted, priced findings with their evidence and reviewers.' },
  { icon: 'Snowflake', title: 'A frozen valuation', body: 'Approved scenarios whose adjustments trace to accepted risks.' },
  { icon: 'Handshake', title: 'Defensible terms', body: 'Escrows, indemnities and price adjustments tied to what diligence found.' },
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="Evidence in. Defensible terms out."
        body="Pactlab connects the deal’s sources, drafts the findings, and leaves every decision to a named person — keeping the chain of evidence intact from first record to final term."
      />
      <Section title="1. Connect the sources" body={SOURCES.body}>
        <FeatureGrid features={SOURCES.items} />
      </Section>
      <Section title="2. Follow the loop" body="Six steps, the same for every deal and every industry." tone="mist">
        <Flow />
      </Section>
      <Section title="3. Decide with the evidence in front of you" body={PRINCIPLES.body} tone="navy">
        <FeatureGrid features={PRINCIPLES.items} columns={2} tone="dark" />
      </Section>
      <Section title="4. Leave with something you can defend">
        <FeatureGrid features={OUTPUTS} columns={2} />
      </Section>
      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
