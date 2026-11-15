import { isTransient, ModelProviderError } from './bedrock';
import type { ModelRequest, ModelResponse, ModelTransport } from './transport';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Transient failures inside `windowMs` that open the breaker. */
  readonly threshold?: number;
  readonly windowMs?: number;
  /** How long the breaker stays open before one probe is let through. */
  readonly coolDownMs?: number;
  readonly now?: () => number;
  /** Called on every state change (metrics, logs): the state only, never content. */
  readonly onStateChange?: (state: CircuitState) => void;
}

/**
 * Counts transient provider failures (T-096). After `threshold` in
 * `windowMs` it opens: calls fail fast for `coolDownMs`, then one probe is
 * let through (half-open). The probe's success closes it; its failure
 * opens it again for another cool-down.
 */
export class CircuitBreaker {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly coolDownMs: number;
  private readonly now: () => number;
  private failures: number[] = [];
  private openedAt: number | null = null;
  private probing = false;
  private current: CircuitState = 'CLOSED';

  constructor(private readonly options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.coolDownMs = options.coolDownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    if (this.current === 'OPEN' && this.openedAt !== null && this.now() - this.openedAt >= this.coolDownMs) this.set('HALF_OPEN');
    return this.current;
  }

  /** Whether a call may go out now. In half-open, only the first caller gets the probe. */
  tryAcquire(): boolean {
    const state = this.state;
    if (state === 'CLOSED') return true;
    if (state === 'OPEN' || this.probing) return false;
    this.probing = true;
    return true;
  }

  recordSuccess(): void {
    this.probing = false;
    this.failures = [];
    this.openedAt = null;
    this.set('CLOSED');
  }

  recordTransientFailure(): void {
    const at = this.now();
    if (this.current === 'HALF_OPEN') return this.open(at);
    this.failures = [...this.failures.filter((time) => at - time < this.windowMs), at];
    if (this.failures.length >= this.threshold) this.open(at);
  }

  /** A failure that says nothing about provider health (bad request, empty answer) releases a probe without moving the breaker. */
  recordOtherFailure(): void {
    this.probing = false;
  }

  private open(at: number): void {
    this.probing = false;
    this.failures = [];
    this.openedAt = at;
    this.set('OPEN');
  }

  private set(state: CircuitState): void {
    if (state === this.current) return;
    this.current = state;
    this.options.onStateChange?.(state);
  }
}

export interface ResilienceEvent {
  readonly type: 'call' | 'transient_failure' | 'fallback' | 'delayed';
  readonly modelId: string;
}

export interface ResilientTransportOptions {
  readonly transport: ModelTransport;
  readonly breaker?: CircuitBreaker;
  /** Calls, failures and fallbacks, for metrics. Model IDs only, never content. */
  readonly onEvent?: (event: ResilienceEvent) => void;
}

/**
 * The gateway's provider boundary in deployed environments (T-096 Part 2).
 * The wrapped transport retries transient errors itself; this adds:
 * - a circuit breaker: while open, calls fail fast with `DELAYED` instead of hanging;
 * - a fallback model: after a transient failure on the primary, a request that
 *   names `fallbackModelId` (only prompts evaluated on it) is tried once there.
 * Access and validation errors pass straight through and never trip the breaker.
 */
export class ResilientModelTransport implements ModelTransport {
  readonly breaker: CircuitBreaker;

  constructor(private readonly options: ResilientTransportOptions) {
    this.breaker = options.breaker ?? new CircuitBreaker();
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.breaker.tryAcquire()) {
      this.emit('delayed', request.modelId);
      throw new ModelProviderError('DELAYED', null);
    }
    try {
      return await this.attempt(request, request.modelId);
    } catch (error) {
      if (!isTransient(error) || !request.fallbackModelId || request.fallbackModelId === request.modelId) throw error;
      this.emit('fallback', request.fallbackModelId);
      return this.attempt(request, request.fallbackModelId);
    }
  }

  private async attempt(request: ModelRequest, modelId: string): Promise<ModelResponse> {
    this.emit('call', modelId);
    try {
      const response = await this.options.transport.complete({ ...request, modelId, fallbackModelId: undefined });
      this.breaker.recordSuccess();
      return { ...response, modelId: response.modelId ?? modelId };
    } catch (error) {
      if (isTransient(error)) {
        this.emit('transient_failure', modelId);
        this.breaker.recordTransientFailure();
      } else {
        this.breaker.recordOtherFailure();
      }
      throw error;
    }
  }

  private emit(type: ResilienceEvent['type'], modelId: string): void {
    this.options.onEvent?.({ type, modelId });
  }
}
