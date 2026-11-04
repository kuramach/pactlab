import { isUuid } from '@pactlab/domain';
import { publicEnv } from '../../../../../lib/env';

/** One picture of a published deal page, for anyone with the link (the API decides). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; mediaId: string }> }): Promise<Response> {
  const { slug, mediaId } = await params;
  if (!/^pl-[a-z0-9]{10}$/.test(slug) || !isUuid(mediaId)) return new Response(null, { status: 404 });
  const upstream = await fetch(new URL(`/v1/public/listings/${slug}/media/${mediaId}`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: 404 });
  return new Response(upstream.body, { headers: { 'content-type': upstream.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
}
