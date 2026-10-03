import type { Permission } from '@pactlab/domain';

/**
 * Server-side session permissions. Web sign-in (Auth0) lands with the deal
 * spine; until then the shell renders the signed-out view. The API enforces
 * authorization regardless of what the UI shows.
 */
export async function getSessionPermissions(): Promise<ReadonlySet<Permission>> {
  return new Set();
}
