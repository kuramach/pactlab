import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../lib/auth0';
import { publicEnv } from '../../../../../lib/env';

/** A bug report's screenshot, for operators only (the API decides). */
export async function GET(_request: Request, { params }: { params: Promise<{ bugId: string }> }): Promise<Response> {
  const { bugId } = await params;
  if (!isUuid(bugId)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/admin/bugs/${bugId}/screenshot`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 403 ? 403 : 404 });
  return new Response(upstream.body, { headers: { 'content-type': upstream.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
