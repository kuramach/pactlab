import type { BillingView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { CreditCard } from 'lucide-react';
import { COMPANY_TYPE_LABELS, type CompanyType } from '@pactlab/domain';
import { apiGet } from '../deals/_lib/api';
import { openPortal, redeemPromo, startCheckout } from './billing-actions';

const MESSAGES: Record<string, string> = {
  returned: 'Thanks. Your purchase appears here as soon as Stripe confirms it, usually within a few seconds.',
  'promo-ok': 'Promo code applied.',
  promo_promo_unknown: 'That promo code isn’t one we know.',
  promo_unknown: 'That promo code isn’t one we know.',
  promo_inactive: 'That promo code is no longer active.',
  promo_not_yet: 'That promo code isn’t active yet.',
  promo_expired: 'That promo code has expired.',
  promo_used_up: 'That promo code has been fully used.',
  promo_already: 'Your organization has already used that promo code.',
  promo_rate_limited: 'Too many code attempts from here. Try again in an hour.',
  'not-configured': 'Payments aren’t switched on in this environment yet.',
  'checkout-failed': 'Checkout couldn’t start. Try again in a moment.',
  'portal-failed': 'The billing portal couldn’t open. Try again in a moment.',
};
const STATUS: Record<BillingView['status'], { label: string; variant: 'calculation' | 'danger' | 'draft' | 'neutral' }> = {
  NONE: { label: 'No plan', variant: 'neutral' },
  ACTIVE: { label: 'Active', variant: 'calculation' },
  PAST_DUE: { label: 'Payment due', variant: 'danger' },
  CANCELED: { label: 'Canceled', variant: 'draft' },
};
const KIND: Record<string, string> = { PACT: 'pact', VENTURE_ROUND: 'Venture Raise round', SELL_SIDE: 'sale' };
const usd = (amount: string, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));

/** Settings → Billing (T-087): plan, what's left, and the ways to pay. Stripe hosts every payment page. */
export async function BillingCard({ outcome }: { outcome?: string }) {
  const result = await apiGet<BillingView>('/v1/billing');
  if (result.kind !== 'ok') return null;
  const view = result.data;
  const credits = Object.entries(
    view.credits.reduce<Record<string, number>>((all, credit) => {
      const label = `${KIND[credit.kind] ?? credit.kind}${credit.packs.length ? ` (${credit.packs.map((pack) => COMPANY_TYPE_LABELS[pack as CompanyType] ?? pack).join(', ')})` : ''}`;
      return { ...all, [label]: (all[label] ?? 0) + 1 };
    }, {}),
  );
  const message = outcome ? MESSAGES[outcome] : undefined;
  return (
    <Card id="billing">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-4 w-4" aria-hidden /> Billing
        </CardTitle>
        <CardDescription>Pay per pact, or subscribe if you run several deals a year. Every plan has unlimited users; people you invite into a pact are always free.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {message ? (
          <p role="status" className="rounded-md border border-border bg-muted px-3 py-2">
            {message}
          </p>
        ) : null}
        {view.status === 'PAST_DUE' ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
            Your last payment didn’t go through. Your pacts stay open, but new ones can’t start until it’s settled.{view.canManage ? ' Update your card in Manage billing.' : ' Ask an organization admin to update the card.'}
          </p>
        ) : null}
        <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {view.pilot ? <Badge variant="calculation">Pilot (free)</Badge> : view.plan ? view.plan.name : 'Pay per pact'}
            {!view.pilot ? <Badge variant={STATUS[view.status].variant}>{STATUS[view.status].label}</Badge> : null}
            {view.periodEnd ? <span className="text-xs text-muted-foreground">renews {view.periodEnd.slice(0, 10)}</span> : null}
          </dd>
          <dt className="text-muted-foreground">Pacts left</dt>
          <dd>
            {view.pilot
              ? 'Unlimited during your pilot'
              : [view.allowanceLeft !== null ? `${view.allowanceLeft} this period` : null, ...credits.map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'} (prepaid)`)].filter(Boolean).join(' · ') || 'None'}
          </dd>
          {view.pendingPromo ? (
            <>
              <dt className="text-muted-foreground">Promo code</dt>
              <dd>
                <Badge variant="neutral" className="font-mono">
                  {view.pendingPromo}
                </Badge>{' '}
                applies at your next checkout
              </dd>
            </>
          ) : null}
        </dl>
        {!view.enforced ? <p className="text-xs text-muted-foreground">Starting pacts isn’t charged yet in this environment; purchases still count.</p> : null}
        {view.canManage && !view.pilot ? (
          <>
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Plans">
              {view.plans.map((plan) => (
                <li key={plan.key} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <span className="font-semibold">{plan.name}</span>
                  <span className="text-lg font-bold">
                    {usd(plan.price.amount, plan.price.currency)}
                    <span className="text-sm font-normal text-muted-foreground">{plan.price.interval ? ` / ${plan.price.interval}` : ' one-time'}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{plan.summary}</span>
                  <form action={startCheckout.bind(null, plan.key)} className="mt-auto">
                    <Button type="submit" size="sm" variant={plan.key === 'PACT' ? 'default' : 'outline'} aria-label={`Buy ${plan.name}`}>
                      {plan.price.interval ? 'Subscribe' : 'Buy'}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-3">
              <form action={redeemPromo} className="flex items-end gap-2">
                <label className="flex flex-col gap-1 font-medium">
                  Have a promo code?
                  <input name="code" required maxLength={40} pattern="[A-Za-z0-9-]{4,40}" className="w-48 rounded-md border border-border bg-background px-3 py-2 uppercase" />
                </label>
                <Button type="submit" size="sm" variant="outline">
                  Apply
                </Button>
              </form>
              {view.hasCustomer ? (
                <form action={openPortal}>
                  <Button type="submit" size="sm" variant="ghost">
                    Manage billing
                  </Button>
                </form>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">Need more than 10 pacts a year, company SSO or invoice billing? Ask us about the Firm plan.</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
