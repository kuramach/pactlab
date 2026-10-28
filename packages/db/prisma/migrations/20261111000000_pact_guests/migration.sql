-- T-094 B12 (ADR 0014): pact guests and invitations.
--
-- A guest is a person from another party (seller, advisor, co-investor) who
-- joins ONE pact, not the pact owner's organization: they hold an active
-- deal membership in the owner's organization and no organization
-- membership there. Their session is scoped to the owner's organization for
-- their pacts only, so every deal-scoped policy (permitted deal ids +
-- buyer-side checks) applies unchanged. The policies that admitted anyone
-- in the current organization are tightened so a guest sees only their pacts
-- and the people on them — never the organization's members, comparables,
-- org-level audit log or deals they are not on.

-- 2. Is the current user a member of the current organization (not a guest)?
--    Owned by pactlab_auth (whose memberships policy is USING (true)) so the
--    memberships policy below can call it without recursing into itself.
CREATE FUNCTION app_is_org_member() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organization_memberships m
       WHERE m.organization_id = app_current_organization_id()
         AND m.user_id = app_current_user_id()
         AND m.status = 'ACTIVE'
    )
  $$;
ALTER FUNCTION app_is_org_member() OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_is_org_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_org_member() TO pactlab_app;

-- 3. Tighten organization-wide policies to organization members.
DROP POLICY organization_memberships_select ON organization_memberships;
CREATE POLICY organization_memberships_select ON organization_memberships FOR SELECT TO pactlab_app
  USING (user_id = app_current_user_id() OR (organization_id = app_current_organization_id() AND app_is_org_member()));
DROP POLICY organization_memberships_insert ON organization_memberships;
CREATE POLICY organization_memberships_insert ON organization_memberships FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND app_is_org_member());
DROP POLICY organization_memberships_update ON organization_memberships;
CREATE POLICY organization_memberships_update ON organization_memberships FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND app_is_org_member())
  WITH CHECK (organization_id = app_current_organization_id() AND app_is_org_member());

-- People: yourself, your organization's members (members only), and the people on your pacts (both sides, names and roles).
DROP POLICY users_select ON users;
CREATE POLICY users_select ON users FOR SELECT TO pactlab_app
  USING (
    auth0_subject = app_current_auth_subject()
    OR id = app_current_user_id()
    OR (app_is_org_member() AND id IN (SELECT m.user_id FROM organization_memberships m WHERE m.organization_id = app_current_organization_id()))
    OR id IN (
      SELECT d.user_id FROM deal_memberships d
       WHERE d.organization_id = app_current_organization_id()
         AND d.deal_id = ANY (app_current_deal_ids())
         AND d.status = 'ACTIVE'
    )
  );

DROP POLICY deals_insert ON deals;
CREATE POLICY deals_insert ON deals FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND created_by = app_current_user_id() AND app_is_org_member());

DROP POLICY audit_events_select ON audit_events;
CREATE POLICY audit_events_select ON audit_events FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND ((deal_id IS NULL AND app_is_org_member()) OR deal_id = ANY (app_current_deal_ids()))
  );
DROP POLICY audit_events_insert ON audit_events;
CREATE POLICY audit_events_insert ON audit_events FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id()
    AND ((deal_id IS NULL AND app_is_org_member()) OR deal_id = ANY (app_current_deal_ids()))
  );

DROP POLICY comparables_select ON comparables;
CREATE POLICY comparables_select ON comparables FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND app_is_org_member() AND app_is_buyer_analyst());
DROP POLICY comparables_insert ON comparables;
CREATE POLICY comparables_insert ON comparables FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND app_is_org_member() AND app_is_buyer_analyst()
    AND recorded_by = app_current_user_id() AND status = 'ACTIVE'
    AND (source_deal_id IS NULL OR (source_deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(source_deal_id)))
  );
DROP POLICY comparables_retire ON comparables;
CREATE POLICY comparables_retire ON comparables FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND app_is_org_member() AND app_is_buyer_analyst() AND status = 'ACTIVE')
  WITH CHECK (organization_id = app_current_organization_id() AND status = 'RETIRED' AND retired_by = app_current_user_id());

-- 4. Invitations: one email, one pact, one side and role; the token is stored only as its hash.
CREATE TABLE "deal_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "role" "deal_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deal_invitations_side_check" CHECK ("side" IN ('BUYER', 'SELLER', 'ADVISOR')),
    CONSTRAINT "deal_invitations_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REVOKED')),
    CONSTRAINT "deal_invitations_email_check" CHECK ("email" = lower(btrim("email")) AND position('@' IN "email") > 1),
    -- The seller side is only ever a target contributor; nobody is invited as deal lead.
    CONSTRAINT "deal_invitations_role_check" CHECK (
      ("side" = 'SELLER' AND "role" = 'TARGET_CONTRIBUTOR')
      OR ("side" = 'ADVISOR' AND "role" IN ('ADVISER', 'VIEWER'))
      OR ("side" = 'BUYER' AND "role" IN ('ANALYST', 'REVIEWER', 'VIEWER'))
    )
);
CREATE UNIQUE INDEX "deal_invitations_token_hash_key" ON "deal_invitations"("token_hash");
CREATE INDEX "deal_invitations_organization_id_deal_id_created_at_idx" ON "deal_invitations"("organization_id", "deal_id", "created_at");
ALTER TABLE "deal_invitations" ADD CONSTRAINT "deal_invitations_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON deal_invitations TO pactlab_app;
ALTER TABLE deal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_invitations FORCE ROW LEVEL SECURITY;
-- The pact's own side manages invitations; guests never see them.
CREATE POLICY deal_invitations_buyer_side ON deal_invitations FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND app_is_org_member())
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND app_is_org_member());

-- 5. What the auth role (security-definer functions only) may touch.
GRANT SELECT, UPDATE ON deal_invitations TO pactlab_auth;
CREATE POLICY deal_invitations_auth ON deal_invitations FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON deal_memberships TO pactlab_auth;
CREATE POLICY deal_memberships_auth_select ON deal_memberships FOR SELECT TO pactlab_auth USING (true);
-- Inserting or reactivating a membership only for an invitation being accepted.
CREATE POLICY deal_memberships_auth_invite ON deal_memberships FOR INSERT TO pactlab_auth
  WITH CHECK (EXISTS (
    SELECT 1 FROM deal_invitations i
     WHERE i.organization_id = deal_memberships.organization_id AND i.deal_id = deal_memberships.deal_id
       AND i.role = deal_memberships.role AND i.status = 'PENDING' AND i.expires_at > now()
  ));
CREATE POLICY deal_memberships_auth_invite_update ON deal_memberships FOR UPDATE TO pactlab_auth
  USING (true)
  WITH CHECK (EXISTS (
    SELECT 1 FROM deal_invitations i
     WHERE i.organization_id = deal_memberships.organization_id AND i.deal_id = deal_memberships.deal_id
       AND i.role = deal_memberships.role AND i.status = 'PENDING' AND i.expires_at > now()
  ));
GRANT SELECT (id, organization_id, name, status) ON deals TO pactlab_auth;
-- The invitation preview and guest list name the inviting organization.
GRANT SELECT (name) ON organizations TO pactlab_auth;
CREATE POLICY deals_auth_select ON deals FOR SELECT TO pactlab_auth USING (true);

-- 6. What an invitation link shows before anyone signs in (the token holder already has the email).
CREATE FUNCTION app_invitation_preview(p_token_hash text)
  RETURNS TABLE (deal_name text, organization_name text, email text, side text, role text, status text, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT d.name, o.name, i.email, i.side, i.role::text,
           CASE WHEN i.status = 'PENDING' AND i.expires_at <= now() THEN 'EXPIRED' ELSE i.status END,
           i.expires_at
      FROM deal_invitations i
      JOIN deals d ON d.organization_id = i.organization_id AND d.id = i.deal_id
      JOIN organizations o ON o.id = i.organization_id
     WHERE i.token_hash = p_token_hash
  $$;
ALTER FUNCTION app_invitation_preview(text) OWNER TO pactlab_auth;

-- An invitation is pending and unexpired for this address (sign-up skips approval and the work-email rule for invitees).
CREATE FUNCTION app_invitation_valid_for(p_token_hash text, p_email text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_invitations i
       WHERE i.token_hash = p_token_hash AND i.email = lower(btrim(p_email)) AND i.status = 'PENDING' AND i.expires_at > now()
    )
  $$;
ALTER FUNCTION app_invitation_valid_for(text, text) OWNER TO pactlab_auth;

-- 7. Accept: the signed-in user's own address must match the invitation; it becomes a deal membership in the pact's organization.
--    Returns the invitation id too, for the audit event.
CREATE FUNCTION app_accept_deal_invitation(p_token_hash text, p_user uuid)
  RETURNS TABLE (organization_id uuid, deal_id uuid, invitation_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  inv deal_invitations%ROWTYPE;
  v_email text;
BEGIN
  SELECT * INTO inv FROM deal_invitations i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.status <> 'PENDING' OR inv.expires_at <= now() THEN
    RETURN;
  END IF;
  SELECT u.email INTO v_email FROM users u WHERE u.id = p_user;
  IF v_email IS NULL OR v_email <> inv.email THEN
    RETURN;
  END IF;
  INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, status)
  VALUES (uuidv7(), inv.organization_id, inv.deal_id, p_user, inv.role, 'ACTIVE')
  ON CONFLICT (organization_id, deal_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE';
  UPDATE deal_invitations SET status = 'ACCEPTED', accepted_by = p_user, accepted_at = now() WHERE id = inv.id;
  -- The API appends the audit event as the new guest (the audit chain is written through the app role).
  RETURN QUERY SELECT inv.organization_id, inv.deal_id, inv.id;
END
$$;
ALTER FUNCTION app_accept_deal_invitation(text, uuid) OWNER TO pactlab_auth;

-- 8. Pacts a user is a guest on (shown in the organization switcher).
CREATE FUNCTION app_guest_pacts(p_user uuid)
  RETURNS TABLE (organization_id uuid, organization_name text, deal_id uuid, deal_name text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT o.id, o.name, d.id, d.name, m.role::text
      FROM deal_memberships m
      JOIN deals d ON d.organization_id = m.organization_id AND d.id = m.deal_id
      JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = p_user AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM organization_memberships om WHERE om.user_id = p_user AND om.organization_id = m.organization_id AND om.status = 'ACTIVE')
     ORDER BY o.name, d.name
  $$;
ALTER FUNCTION app_guest_pacts(uuid) OWNER TO pactlab_auth;

-- 9. A session may move into an organization where the user is a member, or a guest on one of its pacts.
CREATE OR REPLACE FUNCTION app_auth_session_rescope(p_session uuid, p_organization uuid)
  RETURNS TABLE (session_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_old auth_sessions%ROWTYPE;
  v_session uuid := uuidv7();
BEGIN
  SELECT * INTO v_old FROM auth_sessions s
   WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND OR NOT (
    EXISTS (SELECT 1 FROM app_email_code_organizations(v_old.user_id) AS o WHERE o = p_organization)
    OR EXISTS (
      SELECT 1 FROM deal_memberships m JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = v_old.user_id AND m.organization_id = p_organization AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
    )
  ) THEN
    RETURN;
  END IF;
  UPDATE auth_sessions SET revoked_at = now() WHERE id = v_old.id;
  INSERT INTO auth_sessions (id, user_id, organization_id, expires_at)
  VALUES (v_session, v_old.user_id, p_organization, v_old.expires_at);
  RETURN QUERY SELECT v_session, v_old.expires_at;
END
$$;

REVOKE ALL ON FUNCTION app_invitation_preview(text), app_invitation_valid_for(text, text), app_accept_deal_invitation(text, uuid), app_guest_pacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_invitation_preview(text), app_invitation_valid_for(text, text), app_accept_deal_invitation(text, uuid), app_guest_pacts(uuid) TO pactlab_app;
