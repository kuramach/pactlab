import { LOGO_HEADERS, LOGO_TYPES } from '../../../../lib/brand';
import { publicEnv } from '../../../../lib/env';

/** An organization's logo on its own sign-in page (T-123): public, like the page. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return new Response(null, { status: 404 });
  const upstream = await fetch(new URL(`/v1/brand/${slug}/logo`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { cache: 'no-store' });
  const type = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !LOGO_TYPES.has(type)) return new Response(null, { status: 404 });
  return new Response(upstream.body, { headers: { ...LOGO_HEADERS, 'content-type': type, 'cache-control': 'public, max-age=300' } });
}
