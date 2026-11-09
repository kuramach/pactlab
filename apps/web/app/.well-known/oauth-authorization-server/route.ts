import { authorizationServerMetadata, metadataResponse } from '../../../lib/oauth-metadata';

/** RFC 8414 authorization-server metadata (T-084). */
export const dynamic = 'force-dynamic';
export function GET(): Response {
  return metadataResponse(authorizationServerMetadata());
}
