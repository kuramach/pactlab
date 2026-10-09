import { buttonVariants, PactlabLogo } from '@pactlab/ui';
import Link from 'next/link';

/** Unknown address: always a way back to Home and My deals. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-muted p-6 text-center">
      <Link href="/" aria-label="Pactlab home">
        <PactlabLogo />
      </Link>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-indigo-ink">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This page does not exist, or you do not have access to it.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/" className={buttonVariants()}>
          Go to Home
        </Link>
        <Link href="/deals" className={buttonVariants({ variant: 'outline' })}>
          My deals
        </Link>
      </div>
    </main>
  );
}
