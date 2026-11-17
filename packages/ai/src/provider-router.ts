import { ModelProviderError } from './bedrock';
import type { ModelProvider } from './models';
import type { ModelRequest, ModelResponse, ModelTransport } from './transport';

/**
 * Sends each call to its provider's transport (T-131): Bedrock unless the route names another.
 * Each provider keeps its own retries and circuit breaker, so one provider's outage never pauses
 * another. A provider this deployment has no connection for refuses with ACCESS.
 */
export class ProviderRouterTransport implements ModelTransport {
  constructor(private readonly transports: Partial<Record<ModelProvider, ModelTransport>>) {}

  /** The providers this deployment can call. */
  get providers(): ModelProvider[] {
    return (Object.keys(this.transports) as ModelProvider[]).filter((provider) => this.transports[provider]);
  }

  complete(request: ModelRequest): Promise<ModelResponse> {
    const transport = this.transports[request.provider ?? 'bedrock'];
    if (!transport) return Promise.reject(new ModelProviderError('ACCESS', 'PROVIDER_NOT_CONFIGURED'));
    return transport.complete(request);
  }
}
