import { brandThemeVariables } from '@pactlab/domain';
import { notFound } from 'next/navigation';
import { fetchPublicBrand } from '../../../lib/brand';
import { LoginScreen, type LoginParams } from '../login-screen';

// Per-request: reads cookies and query state.
export const dynamic = 'force-dynamic';

/**
 * An organization's own sign-in page (T-123): its logo, colors and name over the usual sign-in.
 * Only organizations that set a brand have one; the rest use `/login`.
 */
export default async function BrandedLoginPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<LoginParams> }) {
  const { slug } = await params;
  const brand = await fetchPublicBrand(slug);
  if (!brand) notFound();
  return (
    <LoginScreen
      params={await searchParams}
      brand={{ slug, name: brand.name, logoUrl: brand.hasLogo ? `/login/${slug}/logo` : null, variables: brandThemeVariables({ accentColor: brand.accentColor, font: brand.font }) }}
    />
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const brand = await fetchPublicBrand((await params).slug);
  return { title: brand ? `Sign in to ${brand.name}` : 'Sign in' };
}
