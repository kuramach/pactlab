-- T-178b (ADR 0059): Pactlab Rinse preparer accounts, prep invites and the AI jobs a preparer runs.
--
-- A preparer is a user with a one-person PREPARER workspace (created_via = 'PREPARER'): free, holding
-- no pacts. A prep invite, created from a pact by its own side, creates the account (or signs an
-- existing user in) and binds the preparer to that organization and deal in one step. A binding gives
-- no deal membership and no read access: only the right to have a rinsed set accepted for that pact and
-- to run AI rinse jobs counted against it (Kumar's decision 4: no separate Rinse billing).
--
-- Sign-up, acceptance and the AI jobs' run records go through SECURITY DEFINER functions owned by
-- pactlab_auth, which take the caller's session id, never a user id.
-- Expand only. Rollback: drop the functions below, then rinse_preparer_bindings, rinse_prep_invites and
-- rinse_preparer_challenges, the policies named *_rinse* and deals_not_in_preparer_workspace.

CREATE TABLE "rinse_prep_invites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,

    CONSTRAINT "rinse_prep_invites_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rinse_prep_invites_email_check" CHECK ("email" = lower(btrim("email")) AND "email" LIKE '%_@_%'),
    CONSTRAINT "rinse_prep_invites_token_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "rinse_prep_invites_token_hash_key" ON "rinse_prep_invites"("token_hash");
CREATE INDEX "rinse_prep_invites_organization_id_deal_id_created_at_idx" ON "rinse_prep_invites"("organization_id", "deal_id", "created_at");
ALTER TABLE "rinse_prep_invites" ADD CONSTRAINT "rinse_prep_invites_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rinse_prep_invites" ADD CONSTRAINT "rinse_prep_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "rinse_preparer_bindings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "preparer_user_id" UUID NOT NULL,
    "bound_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,

    CONSTRAINT "rinse_preparer_bindings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rinse_preparer_bindings_invite_id_key" ON "rinse_preparer_bindings"("invite_id");
CREATE INDEX "rinse_preparer_bindings_organization_id_deal_id_idx" ON "rinse_preparer_bindings"("organization_id", "deal_id");
CREATE INDEX "rinse_preparer_bindings_preparer_user_id_idx" ON "rinse_preparer_bindings"("preparer_user_id");
ALTER TABLE "rinse_preparer_bindings" ADD CONSTRAINT "rinse_preparer_bindings_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rinse_preparer_bindings" ADD CONSTRAINT "rinse_preparer_bindings_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "rinse_prep_invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rinse_preparer_bindings" ADD CONSTRAINT "rinse_preparer_bindings_preparer_user_id_fkey" FOREIGN KEY ("preparer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "rinse_preparer_challenges" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "invite_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),

    CONSTRAINT "rinse_preparer_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rinse_preparer_challenges_email_check" CHECK ("email" = lower(btrim("email")) AND "email" LIKE '%_@_%'),
    CONSTRAINT "rinse_preparer_challenges_name_check" CHECK (length(btrim("display_name")) BETWEEN 1 AND 120),
    CONSTRAINT "rinse_preparer_challenges_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5)
);
CREATE INDEX "rinse_preparer_challenges_email_created_at_idx" ON "rinse_preparer_challenges"("email", "created_at");
CREATE INDEX "rinse_preparer_challenges_ip_hash_created_at_idx" ON "rinse_preparer_challenges"("ip_hash", "created_at");
ALTER TABLE "rinse_preparer_challenges" ADD CONSTRAINT "rinse_preparer_challenges_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "rinse_prep_invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-level security. The pact's own side creates, lists and revokes invites and bindings; a target
-- contributor, bidder, investor or another tenant sees none. Nothing is deleted.
-- ---------------------------------------------------------------------------
ALTER TABLE rinse_prep_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE rinse_prep_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE rinse_preparer_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rinse_preparer_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE rinse_preparer_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE rinse_preparer_challenges FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON rinse_prep_invites TO pactlab_app;
GRANT UPDATE ("revoked_at", "revoked_by") ON rinse_prep_invites TO pactlab_app;
GRANT SELECT ON rinse_preparer_bindings TO pactlab_app;
GRANT UPDATE ("revoked_at", "revoked_by") ON rinse_preparer_bindings TO pactlab_app;

CREATE POLICY rinse_prep_invites_own_side ON rinse_prep_invites FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND created_by = app_current_user_id());
CREATE POLICY rinse_preparer_bindings_own_side ON rinse_preparer_bindings FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));

-- pactlab_auth: what sign-up, acceptance and the AI jobs need, through the functions below only.
GRANT SELECT, INSERT, UPDATE ON rinse_preparer_challenges TO pactlab_auth;
CREATE POLICY rinse_preparer_challenges_auth ON rinse_preparer_challenges FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
GRANT SELECT ON rinse_prep_invites TO pactlab_auth;
GRANT UPDATE ("accepted_at", "accepted_by") ON rinse_prep_invites TO pactlab_auth;
CREATE POLICY rinse_prep_invites_auth ON rinse_prep_invites FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON rinse_preparer_bindings TO pactlab_auth;
CREATE POLICY rinse_preparer_bindings_auth ON rinse_preparer_bindings FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
GRANT SELECT ("created_via") ON organizations TO pactlab_auth;
CREATE POLICY organizations_auth_preparer ON organizations FOR INSERT TO pactlab_auth
  WITH CHECK (auth_method = 'EMAIL_CODE' AND created_via = 'PREPARER' AND status = 'ACTIVE');
-- A preparer's AI rinse jobs are recorded on the bound pact (the existing (organization, deal) key).
GRANT SELECT ("id", "requested_by", "created_at", "prompt_id"), INSERT ON ai_runs TO pactlab_auth;
CREATE POLICY ai_runs_auth_rinse ON ai_runs FOR ALL TO pactlab_auth
  USING (prompt_id IN ('document.classify', 'document.vision'))
  WITH CHECK (prompt_id IN ('document.classify', 'document.vision') AND requested_by IS NOT NULL);
-- Binding a preparer is audited on the pact's chain (the chain trigger reads the deal's last link).
CREATE POLICY audit_events_auth_rinse_insert ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NOT NULL AND target_type = 'rinse_preparer_binding' AND action = 'rinse.preparer_bound');
CREATE POLICY audit_events_auth_rinse_select ON audit_events FOR SELECT TO pactlab_auth
  USING (deal_id IS NOT NULL AND EXISTS (SELECT 1 FROM rinse_prep_invites i WHERE i.deal_id = audit_events.deal_id));

-- ---------------------------------------------------------------------------
-- A preparer workspace holds no pacts (ADR 0059 decision 1).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_is_preparer_workspace(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org AND o.created_via = 'PREPARER') $$;
CREATE POLICY deals_not_in_preparer_workspace ON deals AS RESTRICTIVE FOR INSERT TO pactlab_app
  WITH CHECK (NOT app_is_preparer_workspace(organization_id));

-- The user behind a live Pactlab session, or null.
CREATE FUNCTION app_rinse_session_user(p_session uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT s.user_id FROM auth_sessions s WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now() $$;

-- What an invite link shows before anyone signs in: the pact and who invited, never more.
CREATE FUNCTION app_rinse_invite_peek(p_token_hash text)
  RETURNS TABLE (invite_id uuid, email text, pact_name text, organization_name text, expires_at timestamptz, state text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT i.id, i.email, d.name, o.name, i.expires_at,
           CASE WHEN i.revoked_at IS NOT NULL OR d.status = 'DELETED' THEN 'REVOKED'
                WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'
                WHEN i.expires_at <= now() THEN 'EXPIRED' ELSE 'PENDING' END
      FROM rinse_prep_invites i JOIN deals d ON d.id = i.deal_id AND d.organization_id = i.organization_id
      JOIN organizations o ON o.id = i.organization_id
     WHERE i.token_hash = p_token_hash
  $$;

-- Bind the invite to a user (inside the functions below): the invite pending, the addresses equal.
CREATE FUNCTION app_rinse_bind(p_invite uuid, p_user uuid) RETURNS TABLE (binding_id uuid, organization_id uuid, deal_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_invite rinse_prep_invites%ROWTYPE;
  v_binding uuid := uuidv7();
BEGIN
  SELECT * INTO v_invite FROM rinse_prep_invites i WHERE i.id = p_invite FOR UPDATE;
  IF NOT FOUND OR v_invite.revoked_at IS NOT NULL OR v_invite.accepted_at IS NOT NULL OR v_invite.expires_at <= now()
     OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND u.email = v_invite.email)
     OR EXISTS (SELECT 1 FROM deals d WHERE d.id = v_invite.deal_id AND d.status = 'DELETED') THEN
    RETURN;
  END IF;
  UPDATE rinse_prep_invites SET accepted_at = now(), accepted_by = p_user WHERE id = v_invite.id;
  INSERT INTO rinse_preparer_bindings (id, organization_id, deal_id, invite_id, preparer_user_id)
  VALUES (v_binding, v_invite.organization_id, v_invite.deal_id, v_invite.id, p_user);
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_invite.organization_id, v_invite.deal_id, p_user, 'rinse.preparer_bound', 'rinse_preparer_binding', v_binding::text, 'SUCCEEDED');
  RETURN QUERY SELECT v_binding, v_invite.organization_id, v_invite.deal_id;
END
$$;

-- Start a preparer sign-up from an invite. No row when rate limited or the invite is not pending for
-- this address; existing_user when the address already has an account (it signs in instead).
CREATE FUNCTION app_rinse_preparer_begin(p_token_hash text, p_email text, p_display_name text, p_code_hash text, p_ip_hash text)
  RETURNS TABLE (challenge_id uuid, existing_user boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(p_email));
  v_invite uuid;
  v_id uuid := uuidv7();
BEGIN
  SELECT i.id INTO v_invite FROM rinse_prep_invites i
   WHERE i.token_hash = p_token_hash AND i.email = v_email AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > now();
  IF v_invite IS NULL
     OR (SELECT count(*) FROM rinse_preparer_challenges c WHERE c.email = v_email AND c.created_at > now() - interval '1 hour') >= 3
     OR (SELECT count(*) FROM rinse_preparer_challenges c WHERE c.ip_hash = p_ip_hash AND c.created_at > now() - interval '1 hour') >= 10 THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.email = v_email) THEN
    RETURN QUERY SELECT NULL::uuid, true;
    RETURN;
  END IF;
  UPDATE rinse_preparer_challenges SET expires_at = now() WHERE email = v_email AND consumed_at IS NULL AND expires_at > now();
  INSERT INTO rinse_preparer_challenges (id, email, display_name, invite_id, code_hash, ip_hash, expires_at)
  VALUES (v_id, v_email, btrim(p_display_name), v_invite, p_code_hash, p_ip_hash, now() + interval '10 minutes');
  RETURN QUERY SELECT v_id, false;
END
$$;

-- Complete it: on a correct code, create the user, the PREPARER workspace (active at once, no
-- operator approval), its owner membership and a session, and bind the invite, in one transaction.
CREATE FUNCTION app_rinse_preparer_verify(p_email text, p_code_hash text)
  RETURNS TABLE (user_id uuid, organization_id uuid, session_id uuid, session_expires_at timestamptz, binding_id uuid, deal_id uuid, binding_organization_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(p_email));
  v_challenge rinse_preparer_challenges%ROWTYPE;
  v_org uuid := uuidv7();
  v_user uuid := uuidv7();
  v_session uuid := uuidv7();
  v_expires timestamptz := now() + interval '8 hours';
  v_bound record;
BEGIN
  SELECT * INTO v_challenge FROM rinse_preparer_challenges c
   WHERE c.email = v_email AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < 5
   ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_challenge.code_hash <> p_code_hash THEN
    UPDATE rinse_preparer_challenges SET attempts = attempts + 1 WHERE id = v_challenge.id;
    RETURN;
  END IF;
  UPDATE rinse_preparer_challenges SET consumed_at = now() WHERE id = v_challenge.id;
  IF EXISTS (SELECT 1 FROM users u WHERE u.email = v_email) THEN RETURN; END IF;

  INSERT INTO organizations (id, name, slug, auth_method, status, sso_requested, created_via, updated_at)
  VALUES (v_org, left(v_challenge.display_name, 100) || ' (Pactlab Rinse)', 'rinse-' || replace(v_org::text, '-', ''), 'EMAIL_CODE', 'ACTIVE', false, 'PREPARER', now());
  INSERT INTO users (id, auth0_subject, display_name, email) VALUES (v_user, 'pactlab|' || v_user::text, v_challenge.display_name, v_email);
  INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES (uuidv7(), v_org, v_user, 'ORG_OWNER');
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_org, NULL, v_user, 'org.signup', 'organization', v_org::text, 'SUCCEEDED');
  SELECT * INTO v_bound FROM app_rinse_bind(v_challenge.invite_id, v_user);
  INSERT INTO auth_sessions (id, user_id, organization_id, expires_at) VALUES (v_session, v_user, v_org, v_expires);
  PERFORM app_auth_audit(v_user, 'login.succeeded', 'SUCCEEDED');
  RETURN QUERY SELECT v_user, v_org, v_session, v_expires, v_bound.binding_id, v_bound.deal_id, v_bound.organization_id;
END
$$;

-- An existing user, signed in, accepts an invite addressed to them.
CREATE FUNCTION app_rinse_invite_accept(p_session uuid, p_token_hash text) RETURNS TABLE (binding_id uuid, organization_id uuid, deal_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_user uuid := app_rinse_session_user(p_session);
  v_invite uuid;
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;
  SELECT i.id INTO v_invite FROM rinse_prep_invites i WHERE i.token_hash = p_token_hash;
  IF v_invite IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT b.binding_id, b.organization_id, b.deal_id FROM app_rinse_bind(v_invite, v_user) b;
END
$$;

-- The caller's live bindings: which pact, and who invited. Nothing else of the pact.
CREATE FUNCTION app_rinse_bindings(p_session uuid)
  RETURNS TABLE (binding_id uuid, organization_id uuid, deal_id uuid, pact_name text, organization_name text, bound_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT b.id, b.organization_id, b.deal_id, d.name, o.name, b.bound_at
      FROM rinse_preparer_bindings b JOIN deals d ON d.id = b.deal_id AND d.organization_id = b.organization_id
      JOIN organizations o ON o.id = b.organization_id
     WHERE b.preparer_user_id = app_rinse_session_user(p_session) AND b.revoked_at IS NULL AND d.status <> 'DELETED'
     ORDER BY b.bound_at DESC, b.id
     LIMIT 100
  $$;

-- Record one AI rinse job on the bound pact; returns the number of the caller's rinse jobs in the
-- last 24 hours before this one, or null when the binding is not the caller's live one.
CREATE FUNCTION app_rinse_record_run(p_session uuid, p_binding uuid, p_run jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid := app_rinse_session_user(p_session);
  v_binding rinse_preparer_bindings%ROWTYPE;
  v_count integer;
BEGIN
  IF v_user IS NULL OR p_run->>'promptId' NOT IN ('document.classify', 'document.vision') THEN RETURN NULL; END IF;
  SELECT * INTO v_binding FROM rinse_preparer_bindings b WHERE b.id = p_binding AND b.preparer_user_id = v_user AND b.revoked_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_count FROM ai_runs r WHERE r.requested_by = v_user AND r.prompt_id IN ('document.classify', 'document.vision') AND r.created_at > now() - interval '24 hours';
  INSERT INTO ai_runs (id, organization_id, deal_id, task_type, prompt_id, prompt_version, prompt_hash, model_alias, resolved_model_id, resolved_provider,
                       job_type, fallback_from, fallback_reason, input_hashes, output_hash, status, repair_attempted, injection_signals,
                       input_tokens, output_tokens, latency_ms, created_at, requested_by)
  VALUES ((p_run->>'id')::uuid, v_binding.organization_id, v_binding.deal_id, p_run->>'taskType', p_run->>'promptId', p_run->>'promptVersion', p_run->>'promptHash', p_run->>'modelAlias',
          p_run->>'resolvedModelId', coalesce(p_run->>'resolvedProvider', 'bedrock'), p_run->>'jobType', p_run->>'fallbackFrom', p_run->>'fallbackReason',
          ARRAY(SELECT jsonb_array_elements_text(coalesce(p_run->'inputHashes', '[]'::jsonb))), p_run->>'outputHash', (p_run->>'status')::ai_run_status,
          coalesce((p_run->>'repairAttempted')::boolean, false), coalesce((p_run->>'injectionSignals')::int, 0), coalesce((p_run->>'inputTokens')::int, 0),
          coalesce((p_run->>'outputTokens')::int, 0), coalesce((p_run->>'latencyMs')::int, 0), (p_run->>'createdAt')::timestamptz, v_user)
  ON CONFLICT (id) DO NOTHING;
  RETURN v_count;
END
$$;

-- The caller's rinse jobs in the last 24 hours, checked before a job runs.
CREATE FUNCTION app_rinse_runs_today(p_session uuid) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT count(*)::integer FROM ai_runs r
     WHERE r.requested_by = app_rinse_session_user(p_session) AND r.prompt_id IN ('document.classify', 'document.vision') AND r.created_at > now() - interval '24 hours'
  $$;

-- At sync, whichever side syncs: is this binding live for this pact? The caller must be on the pact.
CREATE FUNCTION app_rinse_binding_live(p_deal uuid, p_binding uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT p_deal = ANY (app_current_deal_ids()) AND EXISTS (
      SELECT 1 FROM rinse_preparer_bindings b WHERE b.id = p_binding AND b.deal_id = p_deal AND b.organization_id = app_current_organization_id() AND b.revoked_at IS NULL)
  $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_is_preparer_workspace(uuid)', 'app_rinse_session_user(uuid)', 'app_rinse_invite_peek(text)', 'app_rinse_bind(uuid, uuid)',
    'app_rinse_preparer_begin(text, text, text, text, text)', 'app_rinse_preparer_verify(text, text)', 'app_rinse_invite_accept(uuid, text)',
    'app_rinse_bindings(uuid)', 'app_rinse_record_run(uuid, uuid, jsonb)', 'app_rinse_runs_today(uuid)', 'app_rinse_binding_live(uuid, uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
  END LOOP;
END
$$;
-- app_rinse_bind and app_rinse_session_user are reached only from inside the others.
GRANT EXECUTE ON FUNCTION app_is_preparer_workspace(uuid), app_rinse_invite_peek(text), app_rinse_preparer_begin(text, text, text, text, text),
  app_rinse_preparer_verify(text, text), app_rinse_invite_accept(uuid, text), app_rinse_bindings(uuid), app_rinse_record_run(uuid, uuid, jsonb),
  app_rinse_runs_today(uuid), app_rinse_binding_live(uuid, uuid) TO pactlab_app;
