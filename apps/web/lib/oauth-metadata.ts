import { publicEnv, serverEnv } from './env';

/**
 * OAuth discovery for the MCP server (T-084, ADR 0024; MCP authorization spec 2026-07-28) and
 * the REST API (T-128), the authorization server's second protected resource.
 * The web origin is the authorization server's issuer (the consent page lives here); the
 * MCP server and the token endpoint are on the API (`/v1`), at the same origin when deployed.
 */
export function oauthOrigins() {
  const issuer = new URL(serverEnv().APP_BASE_URL).origin;
  const api = new URL(publicEnv().NEXT_PUBLIC_API_ORIGIN).origin;
  return { issuer, api, resource: `${api}/v1/mcp`, apiResource: `${api}/v1` };
}

export const MCP_SCOPES = ['mcp:read', 'mcp:confidential', 'mcp:propose'] as const;
export const API_SCOPES = ['api:read', 'api:write'] as const;
export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** RFC 9728 protected-resource metadata. `scopes_supported` is the minimum for basic use. */
export function protectedResourceMetadata() {
  const { issuer, resource } = oauthOrigins();
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: ['mcp:read'],
    bearer_methods_supported: ['header'],
    resource_name: 'Pactlab',
  };
}

/** RFC 9728 protected-resource metadata for the REST API (T-128). */
export function apiResourceMetadata() {
  const { issuer, apiResource } = oauthOrigins();
  return {
    resource: apiResource,
    authorization_servers: [issuer],
    scopes_supported: [...API_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Pactlab API',
    resource_documentation: `${issuer}/developers/api`,
  };
}

/** RFC 8414 authorization-server metadata, with CIMD (preferred) and DCR (fallback). */
export function authorizationServerMetadata() {
  const { issuer, api } = oauthOrigins();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${api}/v1/oauth/token`,
    registration_endpoint: `${api}/v1/oauth/register`,
    revocation_endpoint: `${api}/v1/oauth/revoke`,
    device_authorization_endpoint: `${api}/v1/oauth/device_authorization`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_CODE_GRANT],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...MCP_SCOPES, ...API_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** Discovery documents are public and cacheable; MCP clients fetch them cross-origin. */
export function metadataResponse(body: unknown): Response {
  return Response.json(body, { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
}
