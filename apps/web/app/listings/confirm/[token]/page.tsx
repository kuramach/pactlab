import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PactlabLockup } from '@pactlab/ui';
import type { Metadata } from 'next';
import { confirmRequest } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Confirm your request — Pactlab', robots: { index: false, follow: false } };

/**
 * Confirm a request for access. A button, not an automatic confirmation on load, so mail
 * scanners that open links cannot confirm on someone's behalf.
 */
export default async function ConfirmRequestPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ result?: string }> }) {
  const { token } = await params;
  const { result } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-muted/40 px-4 py-12">
      <PactlabLockup withTagline={false} />
      <Card className="w-full max-w-md">
        {result === 'ok' ? (
          <CardHeader>
            <CardTitle>Request sent to the seller</CardTitle>
            <CardDescription>The seller reviews every request. If they approve yours, you get an email invitation to sign the NDA and see the details.</CardDescription>
          </CardHeader>
        ) : result === 'invalid' ? (
          <CardHeader>
            <CardTitle>This link no longer works</CardTitle>
            <CardDescription>It may have been used already or expired (links last 7 days). Open the deal page again to send a new request.</CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Confirm your request</CardTitle>
              <CardDescription>Confirm that this is your email address. Your request then goes to the seller.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={confirmRequest.bind(null, token)}>
                <Button type="submit">Confirm my request</Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
