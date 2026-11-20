# AI models: adding, evaluating and assigning them (T-131)

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

## Other clouds: OpenAI and Google (ADR 0034)
1. **Create the account and an API key** with the provider. Agree its data-processing terms, with zero retention (no storing or training on our requests). Use an enterprise or paid tier that offers this.
2. **Set the key** (you are asked for it hidden; nothing is printed or saved):
   ```
   scripts/aws.sh login
   scripts/ai-key.sh live openai      # or: stage google, dev openai, …
   ```
   It saves the key in Secrets Manager (`pactlab/<env>/ai/<provider>`) and restarts the API. The provider then shows **Key set** in Admin → AI models.
3. **Record the data terms:** Admin → AI models → *Other clouds: data terms* → tick both boxes, add the region and the agreement reference → Save. Without both ticks, its models can be neither evaluated nor served.
4. **Add a model** (e.g. an OpenAI or Gemini model ID from the provider's model list), **run its evaluation**, then assign it as for Claude above.
5. **To turn a provider off:**
   - untick its terms, which stops its models at once; or
   - run `scripts/ai-key.sh live openai off`, which sets the key back to `unset`.

## While Bedrock is unavailable: Claude through the Anthropic API (T-132)
1. **Create the key:** an Anthropic API key on the organization's account. Ask Anthropic for zero data retention where available.
2. **Set it:** `scripts/aws.sh login`, then `scripts/ai-key.sh live anthropic`. This stores the key and restarts the API.
3. **Record the terms:** Admin → AI models → *Other clouds: data terms* → Anthropic.
4. **Make Anthropic the environment's default:**
   - set `bedrock: { …, provider: 'anthropic' }` in `infra/cdk/config/prod.ts` and deploy;
   - Claude Sonnet, Opus and Haiku (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`) become the catalog's defaults;
   - to use other IDs, set `ANTHROPIC_MODEL_*`.
5. **When Bedrock is back:** remove `provider` (or set it to `bedrock`) and deploy.

## Best-of-breed routing by job type (T-132)
- **Where the routes are:** Admin → AI models → *Platform defaults* now has a row per **job type**: consistency checks, extraction, classification, questions and drafting, image documents, and deep review.
  - **Registry chain (default):** the job follows `JOB_MODEL_MAP`. For example, extraction runs on Gemini Pro when Google is connected, its terms are recorded and the model is evaluated; otherwise it runs on the Balanced Claude model.
  - **A model chosen:** that model goes first, and the chain stays as the fallback.
- **Per organization:** the same rows appear in the organization's settings.
- **Per deployment, without the console:** `MODEL_JOB_<JOB>=provider:modelId`, e.g. `MODEL_JOB_CONTRACT_SCRUB=openai:gpt-5.5`.
- **When a lane fails:** the run records which model it fell back from, and why (`ai_runs.fallback_from`, `fallback_reason`).
- **Cost:** Hosting cost → *By job type* and *By pact and job type*. Enter each model's rates under *Rates* (keyed by model ID) for the estimates.
- **Cost ceiling:** `AI_DEAL_COST_CEILING_USD`. Once a pact's estimated AI spend reaches it, economy lanes go first.

## Consistency checks (T-132 PR 3)
- **When they run:** after **Extract** on an agreement (a customer or supplier contract, loan agreement or lease, or an unclassified file), on job type `contract_scrub`.
- **What they find:** defined terms, cross-references, party names and contradictions. Each problem lands as a **draft** finding (kind `CONSISTENCY`) with exact quotes, in the review queue.
- **How to route them:** set *Consistency checks* under Admin → AI models. Unset, they run on GPT-5.5 when OpenAI is connected and evaluated, and otherwise on the Deep review Claude model.
- **When the check fails** (provider down): the extraction still stands, and the response reports `consistency.status: PROVIDER_ERROR`.

## A deploy's models go live on their own (2026-11-20)
- **Set the models:** set each role's model in `infra/cdk/config/<env>.ts` (`bedrock.modelOverrides`) or in code defaults, and deploy.
- **On boot, the API:**
  1. adds each configured model new to the catalog (*Not evaluated*);
  2. evaluates it in the background, with the same synthetic golden set and probes as **Run evaluation**;
  3. when it passes, makes it the platform default for its role, as long as an operator hasn't set that role in the console;
  4. emails `OPERATOR_EMAIL` either way (*… is live* or *… failed evaluation*). The audit log shows `operator.system.*` entries.
- **Operator choices win:** a route set in the console (or the diagram) never follows the deployment again. To hand a role back to the deployment, set it to the configured model.
- **A failed evaluation** (console or automatic) takes the model out of service at once (*Failed: not serving*). Its role falls back to the deployment's configured model.
- **Bedrock Claude IDs use dashes:** `us.anthropic.claude-opus-5-5`, not `5.5`. The console refuses the dotted form.
