import { newId } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { ModelProviderError } from './bedrock';
import { TransportClaudeGateway, type AiRunRecord } from './gateway';
import { documentQaPrompt, PromptRegistry } from './prompts';
import { CircuitBreaker, ResilientModelTransport, type CircuitState, type ResilienceEvent } from './resilience';
import type { ModelRequest, ModelResponse, ModelTransport } from './transport';

const REQUEST: ModelRequest = {
  modelId: 'us.anthropic.claude-sonnet-5-5',
  effort: 'medium',
  system: 'Synthetic system',
  messages: [{ role: 'user', content: 'Synthetic question' }],
  maxOutputTokens: 100,
};

/** A fake provider: each model ID answers or fails as scripted; no network. */
class FakeTransport implements ModelTransport {
  readonly calls: ModelRequest[] = [];
  constructor(private readonly behaviour: (request: ModelRequest, call: number) => ModelResponse | ModelProviderError) {}
  async complete(request: ModelRequest): Promise<ModelResponse> {
    const result = this.behaviour(request, this.calls.length);
    this.calls.push(request);
    if (result instanceof ModelProviderError) throw result;
    return result;
  }
}

const ok = (text = 'ok'): ModelResponse => ({ text, inputTokens: 1, outputTokens: 1 });
const throttled = () => new ModelProviderError('THROTTLED', 'ThrottlingException');
const down = () => new ModelProviderError('UNAVAILABLE', 'ServiceUnavailableException');

function clock() {
  let at = 1_000_000;
  return { now: () => at, advance: (ms: number) => void (at += ms) };
}

describe('CircuitBreaker', () => {
  it('opens after N transient failures in the window, fails fast, then half-opens for one probe', () => {
    const time = clock();
    const states: CircuitState[] = [];
    const breaker = new CircuitBreaker({ threshold: 3, windowMs: 10_000, coolDownMs: 5_000, now: time.now, onStateChange: (state) => states.push(state) });
    breaker.recordTransientFailure();
    breaker.recordTransientFailure();
    expect(breaker.state).toBe('CLOSED');
    breaker.recordTransientFailure();
    expect(breaker.state).toBe('OPEN');
    expect(breaker.tryAcquire()).toBe(false);

    time.advance(5_000);
    expect(breaker.state).toBe('HALF_OPEN');
    expect(breaker.tryAcquire()).toBe(true);
    // Only one probe at a time.
    expect(breaker.tryAcquire()).toBe(false);
    breaker.recordSuccess();
    expect(breaker.state).toBe('CLOSED');
    expect(states).toEqual(['OPEN', 'HALF_OPEN', 'CLOSED']);
  });

  it('forgets failures outside the window', () => {
    const time = clock();
    const breaker = new CircuitBreaker({ threshold: 3, windowMs: 10_000, now: time.now });
    breaker.recordTransientFailure();
    breaker.recordTransientFailure();
    time.advance(10_001);
    breaker.recordTransientFailure();
    expect(breaker.state).toBe('CLOSED');
  });

  it('a failed probe opens it again for another cool-down', () => {
    const time = clock();
    const breaker = new CircuitBreaker({ threshold: 1, coolDownMs: 5_000, now: time.now });
    breaker.recordTransientFailure();
    time.advance(5_000);
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordTransientFailure();
    expect(breaker.state).toBe('OPEN');
    time.advance(4_999);
    expect(breaker.tryAcquire()).toBe(false);
    time.advance(1);
    expect(breaker.tryAcquire()).toBe(true);
  });

  it('a probe that fails for a non-transient reason frees the probe slot without opening', () => {
    const time = clock();
    const breaker = new CircuitBreaker({ threshold: 1, coolDownMs: 1, now: time.now });
    breaker.recordTransientFailure();
    time.advance(1);
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordOtherFailure();
    expect(breaker.state).toBe('HALF_OPEN');
    expect(breaker.tryAcquire()).toBe(true);
  });
});

describe('ResilientModelTransport', () => {
  it('passes a healthy call through and names the model that answered', async () => {
    const fake = new FakeTransport(() => ok());
    const response = await new ResilientModelTransport({ transport: fake }).complete(REQUEST);
    expect(response).toEqual({ ...ok(), modelId: REQUEST.modelId });
    expect(fake.calls[0]?.fallbackModelId).toBeUndefined();
  });

  it('falls back once to the evaluated model after a transient failure', async () => {
    const events: ResilienceEvent[] = [];
    const fake = new FakeTransport((request) => (request.modelId === REQUEST.modelId ? throttled() : ok('from fallback')));
    const transport = new ResilientModelTransport({ transport: fake, onEvent: (event) => events.push(event) });
    const response = await transport.complete({ ...REQUEST, fallbackModelId: 'us.anthropic.claude-opus-5-5' });
    expect(response).toMatchObject({ text: 'from fallback', modelId: 'us.anthropic.claude-opus-5-5' });
    expect(fake.calls.map((call) => call.modelId)).toEqual([REQUEST.modelId, 'us.anthropic.claude-opus-5-5']);
    expect(events.map((event) => event.type)).toEqual(['call', 'transient_failure', 'fallback', 'call']);
  });

  it('never falls back for access or validation errors, and they never trip the breaker', async () => {
    const breaker = new CircuitBreaker({ threshold: 1 });
    for (const kind of ['ACCESS', 'INVALID_REQUEST', 'EMPTY_RESPONSE'] as const) {
      const fake = new FakeTransport(() => new ModelProviderError(kind, null));
      const transport = new ResilientModelTransport({ transport: fake, breaker });
      await expect(transport.complete({ ...REQUEST, fallbackModelId: 'us.anthropic.claude-opus-5-5' })).rejects.toMatchObject({ kind });
      expect(fake.calls).toHaveLength(1);
    }
    expect(breaker.state).toBe('CLOSED');
  });

  it('without a fallback, a transient failure is the caller\'s error', async () => {
    const fake = new FakeTransport(() => down());
    await expect(new ResilientModelTransport({ transport: fake }).complete(REQUEST)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    expect(fake.calls).toHaveLength(1);
  });

  it('while open, fails fast with DELAYED and makes no provider call; recovers through one probe', async () => {
    const time = clock();
    let healthy = false;
    const fake = new FakeTransport(() => (healthy ? ok() : down()));
    const breaker = new CircuitBreaker({ threshold: 2, coolDownMs: 30_000, now: time.now });
    const transport = new ResilientModelTransport({ transport: fake, breaker });
    await expect(transport.complete(REQUEST)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    await expect(transport.complete(REQUEST)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    await expect(transport.complete(REQUEST)).rejects.toMatchObject({ kind: 'DELAYED' });
    expect(fake.calls).toHaveLength(2);

    healthy = true;
    time.advance(30_000);
    await expect(transport.complete(REQUEST)).resolves.toMatchObject({ text: 'ok' });
    expect(breaker.state).toBe('CLOSED');
  });
});

describe('gateway with the resilient transport', () => {
  const prompt = { ...documentQaPrompt, fallbackEvaluatedOn: ['us.anthropic.claude-opus-5-5'] };
  const answer = JSON.stringify({ unanswerable: true, answer: 'The sources do not say.', claims: [] });
  const request = { organizationId: newId(), dealId: newId(), inputs: [{ classification: 'BUSINESS' as const, text: 'Q?', name: 'question' }] };

  function setup(fallbackModelId: string | undefined, prompts = prompt) {
    const fake = new FakeTransport((call) => (call.modelId === 'us.anthropic.claude-sonnet-5-5' ? throttled() : ok(answer)));
    const runs: AiRunRecord[] = [];
    const gateway = new TransportClaudeGateway({
      transport: new ResilientModelTransport({ transport: fake }),
      registry: new PromptRegistry().register(prompts),
      routes: { balanced: { modelId: 'us.anthropic.claude-sonnet-5-5', effort: 'medium', ...(fallbackModelId ? { fallbackModelId } : {}) } },
      onRun: (run) => void runs.push(run),
    });
    return { gateway, fake, runs, prompts };
  }

  it('records the fallback model as the one that answered', async () => {
    const { gateway, runs, prompts } = setup('us.anthropic.claude-opus-5-5');
    const response = await gateway.invoke(prompts, request);
    expect(response.status).toBe('SUCCEEDED');
    expect(runs[0]?.resolvedModelId).toBe('us.anthropic.claude-opus-5-5');
  });

  it('does not fall back for a prompt not evaluated on the fallback model', async () => {
    const { gateway, fake, runs, prompts } = setup('us.anthropic.claude-opus-5-5', { ...documentQaPrompt, fallbackEvaluatedOn: [] });
    const response = await gateway.invoke(prompts, request);
    expect(response).toMatchObject({ status: 'PROVIDER_ERROR', providerError: 'THROTTLED' });
    expect(fake.calls).toHaveLength(1);
    expect(runs[0]?.resolvedModelId).toBe('us.anthropic.claude-sonnet-5-5');
  });

  it('never falls back to a non-Claude model, even if a prompt lists it', async () => {
    const other = { ...documentQaPrompt, fallbackEvaluatedOn: ['amazon.nova-pro-v1:0'] };
    const { gateway, fake } = setup('amazon.nova-pro-v1:0', other);
    await expect(gateway.invoke(other, request)).resolves.toMatchObject({ status: 'PROVIDER_ERROR' });
    expect(fake.calls.map((call) => call.modelId)).toEqual(['us.anthropic.claude-sonnet-5-5']);
  });
});
