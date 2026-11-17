# AI models: adding, evaluating and assigning them (T-130)

Which models pacts use is managed in the admin console (**Admin → AI models**), not in code. Code asks for a role (*fast*, *balanced* or *deep review*); the console decides which model serves it.

## The rules
- **Only evaluated models serve.**
  - **What runs:** the evaluation is the synthetic golden set and the injection probes. No deal data is ever sent.
  - **To pass:** every golden case passes, every probe is blocked, and citation recall and precision are both at least 90%.
- **Routing order:** an organization's own model for a role first, then the platform default.
- **Allow-lists:** an organization with an allow-list uses only those models. A role with no allowed model is **refused** (`NO_APPROVED_MODEL`), never sent elsewhere.
- **Speed:** changes apply within a minute (the API caches routes for 60 seconds).
- **Audit:** every change is audited (`operator.ai_model.*`, `operator.ai_route.set`, `org.ai_models_set`).

## On first deploy
- The API **adopts the models it is configured with** (the `BEDROCK_MODEL_*` deploy settings, or the code defaults) into the empty catalog. They are marked evaluated, because they serve today, and set as the platform defaults.
- Nothing changes for anyone until an operator changes it here.

## Adding a new Claude model
1. Check the model or inference profile ID in the Bedrock console, e.g. `us.anthropic.claude-opus-5-5`. The task roles may already call any `anthropic.claude-*`.
2. **Add model:** choose the provider, then enter the model ID and a name.
3. **Run evaluation:** it takes a few minutes, one call at a time. Refresh to see the result. A failure lists what missed.
4. **Once it shows "Evaluated: can serve":**
   - make it a **platform default** for a role; or
   - assign it to **one organization** (find the organization, tick its allowed models, pick a model per role).
5. **Retire** old models. A model that is a platform default can't be retired; choose another default first.

## Re-evaluating
Each evaluation records the prompt hashes it ran against. When prompts change, run **Evaluate again** on models in use.

## Other clouds (OpenAI, Google)
These come with ADR 0029 (T-130 PR 2): provider connections, credentials in Secrets Manager, and data-terms records. Until then, the console offers only the providers this environment can call.
