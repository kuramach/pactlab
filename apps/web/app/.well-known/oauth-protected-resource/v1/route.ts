import { apiResourceMetadata, metadataResponse } from '../../../../lib/oauth-metadata';

/** RFC 9728 protected-resource metadata for the REST API (T-128). */
export const dynamic = 'force-dynamic';
export function GET(): Response {
  return metadataResponse(apiResourceMetadata());
}
