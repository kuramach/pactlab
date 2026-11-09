import { metadataResponse, protectedResourceMetadata } from '../../../lib/oauth-metadata';

/** RFC 9728 protected-resource metadata for the MCP server (T-084). */
export const dynamic = 'force-dynamic';
export function GET(): Response {
  return metadataResponse(protectedResourceMetadata());
}
