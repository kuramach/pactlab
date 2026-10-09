import { Badge, buttonVariants, Card, CardContent, EmptyState, PageHeader, Section, Stat } from '@pactlab/ui';
import { ArrowRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { getSessionContext } from '../../lib/session';
import { dealsApi } from './deals/_lib/api';
import { DEAL_TYPE_LABELS, partyLabel, STAGE_LABELS } from './deals/_lib/labels';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const LOOP = ['Source evidence', 'Normalized evidence', 'Reviewable finding', 'Explicit assumption', 'Valuation scenario', 'Proposed deal term', 'Approved action'];

/** Home: your deals at a glance and the fastest way into the next one. */
export default async function HomePage() {
  const session = await getSessionContext();
  if (session.kind !== 'signed-in') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Welcome to Pactlab" description="Test the pact before you sign it." />
        <EmptyState
          title="Sign in to see your deals"
          description="Pactlab keeps every result traceable to source evidence and a reviewer decision."
          action={
            <a href="/login" className={buttonVariants()}>
              Sign in
            </a>
          }
        />
      </div>
    );
  }
  const deals = await dealsApi.list();
  const items = deals.kind === 'ok' ? deals.data.items : [];
  const firstName = session.displayName.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] ?? '';
  const inDiligence = items.filter((deal) => deal.stage === 'DILIGENCE').length;
  const active = items.filter((deal) => deal.status === 'ACTIVE').length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        description={session.organization ? session.organization.name : undefined}
        actions={
          <Link href="/pacts/new" className={buttonVariants()}>
            <Plus aria-hidden className="h-4 w-4" />
            Start a Pact
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="My deals" value={items.length} />
        <Stat label="Active" value={active} />
        <Stat label="In diligence" value={inDiligence} />
      </div>

      <Section
        title="Recent deals"
        actions={
          <Link href="/deals" className="flex items-center gap-1 text-sm font-medium text-indigo-ink hover:underline">
            All deals <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        }
      >
        {items.length === 0 ? (
          <EmptyState
            title="No deals yet"
            description="Start a Pact: describe the buyer and seller, and Pactlab switches on the sources to collect."
            action={
              <Link href="/pacts/new" className={buttonVariants()}>
                Start a Pact
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.slice(0, 6).map((deal) => {
              const buyer = deal.parties?.find((party) => party.role === 'BUYER');
              const seller = deal.parties?.find((party) => party.role === 'SELLER');
              return (
                <Link key={deal.id} href={`/deals/${deal.id}`} className="group">
                  <Card className="h-full transition-colors group-hover:border-indigo">
                    <CardContent className="flex h-full flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold group-hover:text-indigo-ink">{deal.name}</span>
                        <Badge>{STAGE_LABELS[deal.stage] ?? deal.stage}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {buyer && seller ? `${partyLabel(buyer)} → ${partyLabel(seller)}` : deal.targetName}
                      </p>
                      <span className="mt-auto text-xs text-muted-foreground">
                        {DEAL_TYPE_LABELS[deal.transactionType] ?? deal.transactionType}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="How Pactlab works" description="Every result stays traceable to source evidence and a reviewer decision.">
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {LOOP.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-background px-3 py-1">{step}</span>
              {index < LOOP.length - 1 ? <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> : null}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
