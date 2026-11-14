import { LoginScreen, type LoginParams } from './login-screen';

// Per-request: reads cookies and query state.
export const dynamic = 'force-dynamic';

/**
 * Sign-in chooser. Organizations on Auth0 (including company SSO) continue
 * to Auth0; organizations that chose email sign-in get a one-time code.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<LoginParams> }) {
  return <LoginScreen params={await searchParams} />;
}
