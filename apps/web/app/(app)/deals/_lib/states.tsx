import { EmptyState } from '@pactlab/ui';
import { EN, type I18n } from '../../../../lib/i18n';
import type { ApiResult } from './api';

/** Shared signed-out, permission-denied, not-found and error states for deal pages, in the reader's language. */
export function ApiState({ result, t = EN }: { result: Exclude<ApiResult<unknown>, { kind: 'ok' }>; t?: I18n }) {
  const states = t.m.common.states;
  switch (result.kind) {
    case 'signed-out':
      return <EmptyState title={states.signedOut.title} description={states.signedOut.description} />;
    case 'forbidden':
      return <EmptyState title={states.forbidden.title} description={states.forbidden.description} />;
    case 'not-found':
      return <EmptyState title={states.notFound.title} description={states.notFound.description} />;
    case 'error':
      return (
        <EmptyState
          title={states.error.title}
          description={result.requestId ? `${states.error.description} ${t.fill(states.error.reference, { id: result.requestId })}` : states.error.description}
        />
      );
  }
}
