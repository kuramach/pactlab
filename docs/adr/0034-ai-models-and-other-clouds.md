# ADR 0034: AI models managed in the console; other frontier models behind the same gateway (T-131)

**Status:** accepted (2026-11-17). Amends the settled stack row "AI: Claude via AWS Bedrock".

## Context
- **Before:** the model behind each role (fast, balanced, deep review) was code (`DEFAULT_MODEL_ROUTES`) plus deploy settings. A new frontier model, or an account that wants only certain models, needed a code change and a deploy.
- **What Kumar wants (2026-11-17):**
  - control models from the admin console;
  - include other clouds (OpenAI, Google);
  - an allow-list and defaults per organization;
  - only evaluated models may serve.

## Decision
- **Catalog and routing** (`ai_models`, `ai_platform_routes`, `organization_ai_models`, `organization_ai_routes`; ADR 0018's operator functions pattern):
  - **Order:** each call resolves its model from the organization's route, then the platform default, then the configured route. That last step means AI never goes dark, and it is how the first deploy adopts today's models with no change.
  - **Allow-lists:** an organization with an allow-list uses only those models. A role it does not cover is **refused** (`NO_APPROVED_MODEL`), never sent elsewhere.
  - **Caching:** routes are cached for a minute and cleared on every change.
- **The evaluation gate:**
  - **What runs:** a model serves only after `runDocumentEvals`, the synthetic golden set and injection probes, passes against it. Only synthetic material is ever sent.
  - **To pass:** every case passes, every probe is blocked, and citation recall and precision are both at least 0.9.
  - **What's stored:** the result, with the prompt hashes it ran against.
- **Other clouds:**
  - **Transports:** OpenAI's Responses API and Google's Gemini `generateContent`, behind the existing `ModelTransport`. Shapes follow the official `openai` SDK types and Google's API reference.
  - **Unchanged above the transport:** the gateway, schema validation with one repair, citations and run records. The data-classification check runs before any provider is chosen.
  - **Isolation:** each provider has its own retries and circuit breaker.
  - **OpenAI** requests carry `store: false`.
  - **Keys:** one Secrets Manager secret per provider per environment, created as `unset` (provider off), set by `scripts/ai-key.sh`, and injected into the API task at start. Keys are never in code, config, the database or logs.
  - **Data terms gate:** a provider outside AWS can be evaluated and serve only while an operator's record says a data-processing agreement is in place **and** zero retention or no training on our requests. Withdrawing either stops its models at once. Audited.
- **Bedrock stays the default.** It needs no terms record because it runs inside our AWS accounts.

## Consequences
- **Run records:** every AI run records provider and model (`ai_runs.resolved_provider`), so cost, audit and lineage show what answered.
- **Rules unchanged:** citations are mandatory, humans decide, no people, HR or compensation data reaches any model, and outputs are untrusted until citations resolve.
- **Prompts:** prompts are tuned and evaluated per model. A prompt change marks evaluated models for re-evaluation (prompt hashes on record). The T-096 fallback stays Bedrock-to-Bedrock, and only to models a prompt was evaluated on.
- **Rollback:** both migrations are expand-only. Removing the catalog tables returns every call to the configured routes; setting a key back to `unset` turns a provider off.

## Addendum (T-132 PR 1, 2026-11-17): Claude through the direct Anthropic API
- **Why:** Bedrock is blocked org-wide (Error 002, escalated 2026-11-16), so Claude needs a second path.
- **The transport:** `AnthropicModelTransport` uses the Messages API, with shapes from the official `@anthropic-ai/sdk` types. It sends the same request as the Bedrock transport, so a model behaves the same through either.
- **A deployment's default provider is now config:** `AI_PROVIDER=bedrock` or `anthropic`, set per environment by `bedrock.provider` in `infra/cdk/config/*.ts`.
  - **Models:** with `anthropic`, the configured routes are the Messages API model IDs (`DEFAULT_ANTHROPIC_ROUTES`, overridable by `ANTHROPIC_MODEL_*`), adopted into the catalog at boot as provider `anthropic`.
  - **No key:** AI is off, not broken.
  - **Switching back** to Bedrock is that one value.
- **Key:** `pactlab/<env>/ai/anthropic` in Secrets Manager, set by `scripts/ai-key.sh <env> anthropic`.
- **Data terms:** console-added Anthropic models are a provider outside AWS, so they need the terms record like OpenAI and Google. A deployment's *default* provider is chosen in reviewed deploy config, and its terms are recorded alongside in the console.
