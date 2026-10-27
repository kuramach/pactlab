# ADR 0007 — Claude on Amazon Bedrock for document AI

Status: accepted (2026-10-11)

## Context

Document AI (cited Q&A, contract extraction, drafts for human review) was
built against a scripted transport. Production needs a real model, inside
AWS, without long-lived keys, and without sending people data to a model.

## Decision

- **Provider:** Claude on Amazon Bedrock through the **Converse** API
  (`@aws-sdk/client-bedrock-runtime`), behind the existing `ModelTransport`
  port. Tests and CI keep the scripted transport; outbound provider access
  stays blocked there.
- **Models:** aliases route to the US geo inference profiles listed on the
  Bedrock model cards (2026-10-11): `balanced` → `us.anthropic.claude-sonnet-5-5`,
  `deep_review` → `us.anthropic.claude-opus-5-5`, `fast` →
  `us.anthropic.claude-haiku-5-5`. These models have no in-Region endpoint in
  us-east-1; the `us.` profiles keep requests in US Regions. Deployments may
  override per alias (e.g. `eu.` profiles for EU residency).
- **Credentials:** the AWS SDK default chain only — SSO profiles locally,
  task roles when deployed. Bedrock long-term API keys are not used.
- **Switch:** `AI_PROVIDER=bedrock` turns AI on; the default is off, and every
  model call then fails closed (`NOT_CONFIGURED`) after the data-policy check.
- **Effort:** not sent yet. The model cards document effort levels but not the
  Converse field that carries them, so each model's documented default
  applies until the parameter is verified.
- **Unchanged guarantees:** prohibited data classes never reach the model;
  prompts are versioned and hashed; runs are recorded by hash only; every
  accepted finding needs exact citations and a human reviewer.

## Consequences

Turning AI on is an operator action: enable the Claude models in the Bedrock
console, sign in with SSO, set `AI_PROVIDER`/`AWS_REGION`/`AWS_PROFILE`, run
`pnpm ai:check`. Streaming, prompt caching, the effort parameter and OCR for
scanned PDFs are follow-ups.

## Addendum (2026-10-27): always-on AI in deployed environments

Local testing showed the failure mode a human sign-in creates: when the
operator's SSO session expires, every model call fails. Deployed
environments must not depend on a person.

- **Identity:** API and worker tasks call Bedrock with an ECS task role,
  scoped to the configured inference profiles. Credentials come from the
  default chain and are refreshed by the platform; no profiles, no static
  keys, no Bedrock API keys. A CDK test enforces this.
- **Resilience:** transient errors retry with backoff and jitter; a route
  may name a tested fallback Claude model or profile (recorded on the run);
  a circuit breaker fails fast with `AI_DELAYED` during an outage.
- **Durability:** model calls run as idempotent BullMQ jobs, so an outage
  delays drafts instead of losing them; exhausted jobs go to the
  dead-letter queue for re-queue.
- **Degradation:** everything that does not need the model keeps working;
  the UI says AI is delayed and requests are queued.
- **Monitoring:** error-class-only metrics and alarms on error rate, AI job
  age and breaker state.

Local development keeps SSO sign-in by design. Work is tracked in T-095;
the deployed parts land with T-070.
