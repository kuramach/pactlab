import { EmptyState } from '@pactlab/ui';
import type { ApiResult } from './api';

/** Shared signed-out, permission-denied, not-found and error states for deal pages. */
export function ApiState({ result }: { result: Exclude<ApiResult<unknown>, { kind: 'ok' }> }) {
  switch (result.kind) {
    case 'signed-out':
      return (
        <EmptyState
          title="Sign in required"
          description="Sign in to see the deals and evidence you are a member of."
        />
      );
    case 'forbidden':
      return (
        <EmptyState
          title="No access"
          description="Your role on this deal does not include evidence access."
        />
      );
    case 'not-found':
      return (
        <EmptyState
          title="Not found"
          description="This item does not exist or you do not have access to it."
        />
      );
    case 'error':
      return (
        <EmptyState
          title="Something went wrong"
          description={`The request could not be completed.${result.requestId ? ` Reference ${result.requestId}.` : ''}`}
        />
      );
  }
}
