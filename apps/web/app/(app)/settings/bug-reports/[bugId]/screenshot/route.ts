import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../lib/env';

/** The screenshot attached to one of your own reports (the API checks it is yours). */
export async function GET(_request: Request, { params }: { params: Promise<{ bugId: string }> }): Promise<Response> {
  const { bugId } = await params;
  if (!isUuid(bugId)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/bug-reports/mine/${bugId}/screenshot`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: 404 });
  return new Response(upstream.body, { headers: { 'content-type': upstream.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
