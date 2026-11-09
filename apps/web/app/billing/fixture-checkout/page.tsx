import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthFrame } from '../../_components/auth-frame';
import { publicEnv } from '../../../lib/env';
import { payFixture } from './actions';

export const dynamic = 'force-dynamic';

/**
 * The stand-in for Stripe Checkout where no Stripe keys are set (T-087): local runs and tests.
 * Never in production. Paying sends the same signed events Stripe would, through the real webhook path.
 */
export default async function FixtureCheckoutPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  if (publicEnv().NEXT_PUBLIC_APP_ENV === 'production') notFound();
  const { session } = await searchParams;
  if (!session || !/^cs_fixture_[a-f0-9]{18}$/.test(session)) notFound();
  return (
    <AuthFrame>
      <Card className="w-full shadow-xl shadow-navy/10">
        <CardHeader>
          <CardTitle>Test checkout</CardTitle>
          <CardDescription>This environment has no Stripe keys, so this page stands in for Stripe Checkout. No money moves.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <form action={payFixture.bind(null, session)}>
            <Button type="submit">Pay (test)</Button>
          </form>
          <Link href="/settings#billing" className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </Link>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
