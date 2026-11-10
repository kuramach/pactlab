-- Shareable demo pool (T-113, ADR 0028): five demo organizations an operator lends out for a
-- fixed time through two magic links (buyer and seller). A link opens a session without a code;
-- the session ends when the share does, and a scheduled sweep rebuilds the slot afterwards.
-- Expand-only: two new tables, one nullable column, new functions; the session check is replaced
-- with the same columns plus one, so a running API keeps working.
-- Rollback: drop the functions, the two tables and auth_sessions.demo_share_id; restore
-- app_auth_session_check from 20261202000000_trusted_sessions.

-- 1. The slots: one demo organization each, with the two people the links sign in as.
CREATE TABLE "demo_slots" (
    "organization_id" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "buyer_user_id" UUID NOT NULL,
    "seller_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESETTING',
    "reset_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "demo_slots_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "demo_slots_slot_key" UNIQUE ("slot"),
    CONSTRAINT "demo_slots_status_check" CHECK ("status" IN ('AVAILABLE', 'SHARED', 'RESETTING')),
    CONSTRAINT "demo_slots_slot_check" CHECK ("slot" BETWEEN 1 AND 20),
    CONSTRAINT "demo_slots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "demo_slots_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "demo_slots_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 2. The shares: who it is for, how long, and the two links as keyed hashes (never the links).
CREATE TABLE "demo_shares" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shared_with" TEXT NOT NULL,
    "created_by" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "ended_by" UUID,
    "buyer_token_hash" CHAR(64) NOT NULL,
    "seller_token_hash" CHAR(64) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    CONSTRAINT "demo_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "demo_shares_buyer_token_hash_key" UNIQUE ("buyer_token_hash"),
    CONSTRAINT "demo_shares_seller_token_hash_key" UNIQUE ("seller_token_hash"),
    CONSTRAINT "demo_shares_shared_with_check" CHECK (char_length("shared_with") BETWEEN 1 AND 200),
    CONSTRAINT "demo_shares_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "demo_slots"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- At most one live share per slot.
CREATE UNIQUE INDEX "demo_shares_one_live_idx" ON "demo_shares"("organization_id") WHERE "ended_at" IS NULL;

-- 3. A session opened by a demo link names its share, so it ends when the share does.
ALTER TABLE "auth_sessions" ADD COLUMN "demo_share_id" UUID,
  ADD CONSTRAINT "auth_sessions_demo_share_id_fkey" FOREIGN KEY ("demo_share_id") REFERENCES "demo_shares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE demo_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE demo_shares FORCE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON demo_slots TO pactlab_ops;
GRANT SELECT, INSERT, UPDATE ON demo_shares TO pactlab_ops;
GRANT SELECT ON demo_slots TO pactlab_auth;
GRANT SELECT, UPDATE (last_used_at) ON demo_shares TO pactlab_auth;
CREATE POLICY demo_slots_ops ON demo_slots FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
CREATE POLICY demo_shares_ops ON demo_shares FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
CREATE POLICY demo_slots_auth ON demo_slots FOR SELECT TO pactlab_auth USING (true);
CREATE POLICY demo_shares_auth ON demo_shares FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
-- Operators revoke a share's sessions when it ends.
GRANT SELECT, UPDATE (revoked_at) ON auth_sessions TO pactlab_ops;
CREATE POLICY auth_sessions_ops ON auth_sessions FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
DROP POLICY audit_events_ops ON audit_events;
CREATE POLICY audit_events_ops ON audit_events FOR ALL TO pactlab_ops USING (true)
  WITH CHECK (actor_user_id IS NULL OR action LIKE 'org.%' OR action LIKE 'member.%' OR action LIKE 'bug.%' OR action LIKE 'operator.%' OR action LIKE 'demo.%');

-- 4. Operators: the pool, with the live share on each slot.
CREATE FUNCTION app_ops_demo_slots(p_actor uuid)
  RETURNS TABLE (organization_id uuid, slot integer, organization_name text, status text, reset_at timestamptz, last_error text,
                 share_id uuid, shared_with text, starts_at timestamptz, ends_at timestamptz, last_used_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT s.organization_id, s.slot, o.name, s.status, s.reset_at, s.last_error, d.id, d.shared_with, d.starts_at, d.ends_at, d.last_used_at
      FROM demo_slots s JOIN organizations o ON o.id = s.organization_id
      LEFT JOIN demo_shares d ON d.organization_id = s.organization_id AND d.ended_at IS NULL
     ORDER BY s.slot;
END
$$;

-- 5. Lend the first free slot for 1, 3 or 7 days. Raises NO_SLOT_FREE when all are out.
CREATE FUNCTION app_ops_demo_share(p_actor uuid, p_shared_with text, p_hours integer, p_buyer_hash text, p_seller_hash text)
  RETURNS TABLE (share_id uuid, organization_id uuid, slot integer, ends_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_slot demo_slots%ROWTYPE;
  v_id uuid := uuidv7();
  v_ends timestamptz;
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_hours NOT IN (24, 72, 168) THEN RAISE EXCEPTION 'INVALID_LENGTH' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_slot FROM demo_slots s WHERE s.status = 'AVAILABLE' ORDER BY s.slot LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_SLOT_FREE' USING ERRCODE = 'P0002'; END IF;
  v_ends := now() + make_interval(hours => p_hours);
  INSERT INTO demo_shares (id, organization_id, shared_with, created_by, ends_at, buyer_token_hash, seller_token_hash)
  VALUES (v_id, v_slot.organization_id, btrim(p_shared_with), p_actor, v_ends, p_buyer_hash, p_seller_hash);
  UPDATE demo_slots SET status = 'SHARED', updated_at = now() WHERE organization_id = v_slot.organization_id;
  PERFORM app_ops_audit(p_actor, v_slot.organization_id, 'demo.shared', 'demo_share', v_id);
  RETURN QUERY SELECT v_id, v_slot.organization_id, v_slot.slot, v_ends;
END
$$;

-- 6. End a share now: its sessions end at once and the slot waits for the next sweep to rebuild it.
CREATE FUNCTION app_ops_demo_end(p_actor uuid, p_share uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org uuid;
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE demo_shares SET ended_at = now(), ended_by = p_actor WHERE id = p_share AND ended_at IS NULL RETURNING demo_shares.organization_id INTO v_org;
  IF v_org IS NULL THEN RETURN false; END IF;
  UPDATE auth_sessions SET revoked_at = now() WHERE demo_share_id = p_share AND revoked_at IS NULL;
  UPDATE demo_slots SET status = 'RESETTING', updated_at = now() WHERE organization_id = v_org;
  PERFORM app_ops_audit(p_actor, v_org, 'demo.ended', 'demo_share', p_share);
  RETURN true;
END
$$;

-- 7. Rebuild a slot on the next sweep (a failed reset, or fresh data). Not while it is shared.
CREATE FUNCTION app_ops_demo_reset(p_actor uuid, p_org uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE demo_slots SET status = 'RESETTING', updated_at = now() WHERE organization_id = p_org AND status <> 'SHARED';
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_ops_audit(p_actor, p_org, 'demo.reset', 'organization', p_org);
  RETURN true;
END
$$;

-- 8. Sign in with a demo link: a live share's buyer or seller link opens a session for that
--    slot's person, ending with the share (and after 12 hours at most; the link works again).
CREATE FUNCTION app_demo_link_login(p_token_hash text)
  RETURNS TABLE (session_id uuid, user_id uuid, subject text, organization_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_share demo_shares%ROWTYPE;
  v_slot demo_slots%ROWTYPE;
  v_user uuid;
  v_session uuid := uuidv7();
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_share FROM demo_shares d
   WHERE (d.buyer_token_hash = p_token_hash OR d.seller_token_hash = p_token_hash) AND d.ended_at IS NULL AND d.ends_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_slot FROM demo_slots s WHERE s.organization_id = v_share.organization_id AND s.status = 'SHARED';
  IF NOT FOUND THEN RETURN; END IF;
  v_user := CASE WHEN v_share.buyer_token_hash = p_token_hash THEN v_slot.buyer_user_id ELSE v_slot.seller_user_id END;
  v_expires := least(v_share.ends_at, now() + interval '12 hours');
  INSERT INTO auth_sessions (id, user_id, organization_id, expires_at, signed_in_at, demo_share_id, device_label)
  VALUES (v_session, v_user, v_share.organization_id, v_expires, now(), v_share.id, 'Shared demo link');
  UPDATE demo_shares SET last_used_at = now() WHERE id = v_share.id;
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_share.organization_id, NULL, v_user, 'login.demo_link', 'user', v_user::text, 'SUCCEEDED');
  RETURN QUERY SELECT v_session, v_user, u.auth0_subject, v_share.organization_id, v_expires FROM users u WHERE u.id = v_user;
END
$$;

-- 9. The per-request session check, now also ending a demo-link session with its share, and
--    saying whether the session came from a demo link (outward actions are refused for those).
DROP FUNCTION app_auth_session_check(uuid, text, uuid);
CREATE FUNCTION app_auth_session_check(p_session uuid, p_subject text, p_organization uuid)
  RETURNS TABLE (signed_in_at timestamptz, demo boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_row auth_sessions%ROWTYPE;
BEGIN
  SELECT s.* INTO v_row FROM auth_sessions s JOIN users u ON u.id = s.user_id
   WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
     AND u.auth0_subject = p_subject
     AND s.organization_id IS NOT DISTINCT FROM p_organization;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_row.trusted AND (
    v_row.last_seen_at <= now() - interval '24 hours'
    OR v_row.signed_in_at + app_auth_trust_cap(v_row.organization_id) <= now()
  ) THEN
    RETURN;
  END IF;
  IF v_row.demo_share_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM demo_shares d WHERE d.id = v_row.demo_share_id AND d.ended_at IS NULL AND d.ends_at > now()
  ) THEN
    RETURN;
  END IF;
  IF v_row.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE auth_sessions SET last_seen_at = now() WHERE id = v_row.id;
  END IF;
  RETURN QUERY SELECT v_row.signed_in_at, v_row.demo_share_id IS NOT NULL;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_ops_demo_slots(uuid)', 'app_ops_demo_share(uuid, text, integer, text, text)', 'app_ops_demo_end(uuid, uuid)', 'app_ops_demo_reset(uuid, uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['app_demo_link_login(text)', 'app_auth_session_check(uuid, text, uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
