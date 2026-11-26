-- T-144: the background sweep that polls open envelopes (the fallback for a missed webhook).
-- - app_signing_open_page: one keyset page (by id, ascending) of open envelopes (SENT or DELIVERED)
--   not checked since p_stale_before, across organizations; the worker has no tenant session.
-- - app_signing_poll_failed: an envelope the sweep could not poll. Stamps checked_at (so a broken
--   envelope is retried on the next interval, not every sweep) and writes a `signing.poll_failed`
--   audit event on the pact, at most one per envelope per day, so the pact team can see it.
-- Expand-only: two new functions, no table changes. Rollback: drop both functions and the audit policy.

CREATE FUNCTION app_signing_open_page(p_stale_before timestamptz, p_after uuid, p_limit int)
  RETURNS TABLE (envelope_row_id uuid, organization_id uuid, deal_id uuid, provider text, provider_envelope_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  SELECT e.id, e.organization_id, e.deal_id, e.provider, e.provider_envelope_id
    FROM signature_envelopes e
   WHERE e.status IN ('SENT', 'DELIVERED')
     AND (e.checked_at IS NULL OR e.checked_at < p_stale_before)
     AND (p_after IS NULL OR e.id > p_after)
   ORDER BY e.id
   LIMIT least(greatest(p_limit, 1), 200)
$$;
ALTER FUNCTION app_signing_open_page(timestamptz, uuid, int) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_signing_open_page(timestamptz, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_signing_open_page(timestamptz, uuid, int) TO pactlab_app;

CREATE FUNCTION app_signing_poll_failed(p_envelope uuid)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_env signature_envelopes%ROWTYPE;
BEGIN
  SELECT * INTO v_env FROM signature_envelopes e WHERE e.id = p_envelope AND e.status IN ('SENT', 'DELIVERED') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE signature_envelopes SET checked_at = now() WHERE id = v_env.id;
  IF EXISTS (SELECT 1 FROM audit_events a WHERE a.organization_id = v_env.organization_id AND a.action = 'signing.poll_failed'
                AND a.target_id = v_env.id::text AND a.occurred_at > now() - interval '1 day') THEN
    RETURN false;
  END IF;
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_env.organization_id, v_env.deal_id, NULL, 'signing.poll_failed', 'signature_envelope', v_env.id::text, 'FAILED');
  RETURN true;
END
$$;
ALTER FUNCTION app_signing_poll_failed(uuid) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_signing_poll_failed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_signing_poll_failed(uuid) TO pactlab_app;

-- The sweep's failure is audited on the deal's chain by app_signing_poll_failed.
CREATE POLICY audit_events_auth_signing_poll_insert ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NOT NULL AND actor_user_id IS NULL AND target_type = 'signature_envelope' AND action = 'signing.poll_failed');
