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
