-- Slack and Microsoft Teams as message channels (T-181, ADR 0065), on the T-180 contact tables.
--   * an organization admin installs Pactlab into the company's Slack workspace or Teams tenant once
--     (`chat_installs`); the Slack bot token lives in the credential store, only its reference here;
--   * a person links by their verified Pactlab email and confirms in Slack or Teams; the link is a
--     `user_contact_channels` row (kinds SLACK and TEAMS) that names its install;
--   * Teams needs the conversation reference captured when the app is installed for the person
--     (`teams_conversation_refs`), matched to a Pactlab person only by a keyed hash of their email;
--   * uninstall and token revocation end the install and every link on it at once;
--   * workspace and tenant ids, platform user ids, tokens and conversation references are personal or
--     credential data: the runtime role reads none of these tables; SECURITY DEFINER functions owned by
--     `pactlab_auth` act on the signed-in person, and an admin sees only which members are linked.
-- Expand-only: two new tables, one nullable column, wider CHECKs (every existing row still passes),
-- new functions, and `app_contact_delivery_finish` replaced with the same signature (it now also audits
-- each Slack and Teams delivery outcome).
-- Rollback: revoke every SLACK and TEAMS channel and verification row, drop the functions below and
-- `user_contact_channels.install_id`, restore the CHECKs and `app_contact_delivery_finish` from
-- 20270121000000_contact_channels, then drop teams_conversation_refs and chat_installs.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "chat_installs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    -- The Slack workspace (team) id, or the Microsoft Entra tenant id. Never shown to anyone.
    "external_tenant" TEXT NOT NULL,
    -- Slack: the bot token's reference in the credential store. Teams: none (Pactlab's own bot credentials).
    "credential_ref" TEXT,
    "installed_by" UUID NOT NULL,
    "installed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    CONSTRAINT "chat_installs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_installs_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_installs_user_fkey" FOREIGN KEY ("installed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_installs_provider_check" CHECK ("provider" IN ('SLACK', 'TEAMS')),
    CONSTRAINT "chat_installs_tenant_check" CHECK (
      ("provider" = 'SLACK' AND "external_tenant" ~ '^T[A-Z0-9]{1,31}$' AND "credential_ref" ~ '^secretref:')
      OR ("provider" = 'TEAMS' AND "external_tenant" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND "credential_ref" IS NULL)),
    CONSTRAINT "chat_installs_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL)),
    CONSTRAINT "chat_installs_reason_check" CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN ('ADMIN', 'UNINSTALLED', 'TOKENS_REVOKED', 'REPLACED'))
);
-- One live install per organization and platform, and a workspace or tenant belongs to one organization at a time.
CREATE UNIQUE INDEX "chat_installs_live_org" ON "chat_installs"("organization_id", "provider") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "chat_installs_live_tenant" ON "chat_installs"("provider", "external_tenant") WHERE "revoked_at" IS NULL;

-- Where each person's personal chat with the Teams bot lives, captured from the verified install event.
CREATE TABLE "teams_conversation_refs" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "aad_object_id" TEXT NOT NULL,
    -- A keyed hash of the member's email (never the address), to match a Pactlab person's verified email.
    "email_hash" CHAR(64),
    "service_url" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),
    CONSTRAINT "teams_conversation_refs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "teams_conversation_refs_ids_check" CHECK (
      "tenant_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND "aad_object_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    CONSTRAINT "teams_conversation_refs_url_check" CHECK ("service_url" ~ '^https://' AND length("service_url") <= 300),
    CONSTRAINT "teams_conversation_refs_conversation_check" CHECK (length("conversation_id") BETWEEN 1 AND 300)
);
CREATE UNIQUE INDEX "teams_conversation_refs_member" ON "teams_conversation_refs"("tenant_id", "aad_object_id");
CREATE INDEX "teams_conversation_refs_email_idx" ON "teams_conversation_refs"("tenant_id", "email_hash");

-- A Slack or Teams link names its install, so ending the install ends every link on it.
ALTER TABLE "user_contact_channels" ADD COLUMN "install_id" UUID;
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_install_fkey" FOREIGN KEY ("install_id") REFERENCES "chat_installs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "user_contact_channels_install_idx" ON "user_contact_channels"("install_id");

ALTER TABLE "user_contact_channels" DROP CONSTRAINT "user_contact_channels_kind_check";
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_kind_check" CHECK ("kind" IN ('TELEGRAM', 'WHATSAPP', 'SLACK', 'TEAMS'));
ALTER TABLE "user_contact_channels" DROP CONSTRAINT "user_contact_channels_handle_check";
-- Slack: `<team>:<member>`. Teams: `<tenant>:<Entra object id>`. Unique per platform among live links.
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_handle_check" CHECK (
  ("kind" = 'TELEGRAM' AND "handle" ~ '^[0-9]{1,20}$')
  OR ("kind" = 'WHATSAPP' AND "handle" ~ '^\+[1-9][0-9]{6,14}$')
  OR ("kind" = 'SLACK' AND "handle" ~ '^T[A-Z0-9]{1,31}:[UW][A-Z0-9]{1,31}$')
  OR ("kind" = 'TEAMS' AND "handle" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_install_check" CHECK (("kind" IN ('SLACK', 'TEAMS')) = ("install_id" IS NOT NULL));
ALTER TABLE "user_contact_channels" DROP CONSTRAINT "user_contact_channels_reason_check";
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_reason_check" CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN ('USER', 'BLOCKED', 'STOP', 'REPLACED', 'UNINSTALLED'));

ALTER TABLE "contact_verifications" DROP CONSTRAINT "contact_verifications_kind_check";
ALTER TABLE "contact_verifications" ADD CONSTRAINT "contact_verifications_kind_check" CHECK ("kind" IN ('EMAIL', 'TELEGRAM', 'WHATSAPP', 'SLACK', 'TEAMS'));
ALTER TABLE "contact_verifications" DROP CONSTRAINT "contact_verifications_target_check";
ALTER TABLE "contact_verifications" ADD CONSTRAINT "contact_verifications_target_check" CHECK (
  ("kind" = 'EMAIL' AND "target" = lower(btrim("target")) AND "target" LIKE '%_@_%')
  OR ("kind" = 'TELEGRAM' AND "target" IS NULL)
  OR ("kind" = 'WHATSAPP' AND "target" ~ '^\+[1-9][0-9]{6,14}$' AND "consent_text" IS NOT NULL)
  OR ("kind" = 'SLACK' AND "target" ~ '^T[A-Z0-9]{1,31}:[UW][A-Z0-9]{1,31}$')
  OR ("kind" = 'TEAMS' AND "target" ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$'));

-- ---------------------------------------------------------------------------
-- Row-level security: the runtime role reads neither table; pactlab_auth's functions do.
-- ---------------------------------------------------------------------------
ALTER TABLE chat_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_installs FORCE ROW LEVEL SECURITY;
ALTER TABLE teams_conversation_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_conversation_refs FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON chat_installs, teams_conversation_refs TO pactlab_auth;
GRANT SELECT ("id", "display_name") ON users TO pactlab_auth;
CREATE POLICY chat_installs_auth ON chat_installs FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY teams_conversation_refs_auth ON teams_conversation_refs FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Functions. Owned by pactlab_auth; the runtime role may only execute the ones granted at the end.
-- ---------------------------------------------------------------------------

-- One audit row against a person (the installer, or the person linked), with or without an actor
-- (a provider's verified webhook has none). Within the `contact.%` audit policy.
CREATE FUNCTION app_chat_audit(p_organization uuid, p_actor uuid, p_user uuid, p_action text, p_outcome text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    VALUES (uuidv7(), p_organization, NULL, p_actor, p_action, 'user', p_user::text, p_outcome)
  $$;

-- The signed-in person, when they are an active owner or admin of the organization they are signed in to.
CREATE FUNCTION app_chat_admin_caller() RETURNS TABLE (user_id uuid, organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT c.user_id, c.organization_id FROM app_contact_caller() c
     WHERE EXISTS (SELECT 1 FROM organization_memberships m
                    WHERE m.organization_id = c.organization_id AND m.user_id = c.user_id
                      AND m.status = 'ACTIVE' AND m.role IN ('ORG_OWNER', 'ORG_ADMIN'))
  $$;

-- End an install and every link on it. Returns the credential reference (to revoke and destroy).
CREATE FUNCTION app_chat_install_end(p_install uuid, p_reason text, p_actor uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_install chat_installs%ROWTYPE;
  v_link record;
BEGIN
  UPDATE chat_installs SET revoked_at = now(), revoked_reason = p_reason
   WHERE id = p_install AND revoked_at IS NULL RETURNING * INTO v_install;
  IF v_install.id IS NULL THEN
    RETURN NULL;
  END IF;
  FOR v_link IN
    UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'UNINSTALLED'
     WHERE install_id = p_install AND revoked_at IS NULL RETURNING organization_id, user_id
  LOOP
    PERFORM app_chat_audit(v_link.organization_id, p_actor, v_link.user_id, 'contact.' || lower(v_install.provider) || '_disconnected', 'SUCCEEDED');
  END LOOP;
  UPDATE contact_verifications SET expires_at = now()
   WHERE organization_id = v_install.organization_id AND kind = v_install.provider AND consumed_at IS NULL AND expires_at > now();
  PERFORM app_chat_audit(v_install.organization_id, p_actor, v_install.installed_by,
    'contact.' || lower(v_install.provider) || CASE p_reason WHEN 'TOKENS_REVOKED' THEN '_tokens_revoked' ELSE '_uninstalled' END, 'SUCCEEDED');
  RETURN v_install.credential_ref;
END
$$;

-- An admin installs (or reinstalls) Pactlab. A workspace or tenant another organization holds is refused.
-- Returns the install id and the reference of the install it replaced (to destroy), or nothing when refused.
CREATE FUNCTION app_chat_install_save(p_provider text, p_tenant text, p_credential_ref text)
  RETURNS TABLE (install_id uuid, replaced_ref text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_org uuid;
  v_previous uuid;
  v_replaced text;
  v_id uuid := uuidv7();
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_chat_admin_caller() c;
  IF v_user IS NULL OR p_provider NOT IN ('SLACK', 'TEAMS') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM chat_installs i WHERE i.provider = p_provider AND i.external_tenant = p_tenant
               AND i.revoked_at IS NULL AND i.organization_id <> v_org) THEN
    PERFORM app_chat_audit(v_org, v_user, v_user, 'contact.' || lower(p_provider) || '_installed', 'DENIED');
    RETURN;
  END IF;
  SELECT i.id INTO v_previous FROM chat_installs i WHERE i.organization_id = v_org AND i.provider = p_provider AND i.revoked_at IS NULL;
  IF v_previous IS NOT NULL THEN
    -- The same workspace again keeps its links; another workspace ends them.
    IF (SELECT i.external_tenant FROM chat_installs i WHERE i.id = v_previous) = p_tenant THEN
      UPDATE chat_installs SET revoked_at = now(), revoked_reason = 'REPLACED' WHERE id = v_previous RETURNING credential_ref INTO v_replaced;
      INSERT INTO chat_installs (id, organization_id, provider, external_tenant, credential_ref, installed_by)
      VALUES (v_id, v_org, p_provider, p_tenant, p_credential_ref, v_user);
      UPDATE user_contact_channels SET install_id = v_id WHERE install_id = v_previous AND revoked_at IS NULL;
      PERFORM app_chat_audit(v_org, v_user, v_user, 'contact.' || lower(p_provider) || '_installed', 'SUCCEEDED');
      RETURN QUERY SELECT v_id, v_replaced;
      RETURN;
    END IF;
    v_replaced := app_chat_install_end(v_previous, 'ADMIN', v_user);
  END IF;
  INSERT INTO chat_installs (id, organization_id, provider, external_tenant, credential_ref, installed_by)
  VALUES (v_id, v_org, p_provider, p_tenant, p_credential_ref, v_user);
  PERFORM app_chat_audit(v_org, v_user, v_user, 'contact.' || lower(p_provider) || '_installed', 'SUCCEEDED');
  RETURN QUERY SELECT v_id, v_replaced;
END
$$;

-- An admin removes Pactlab from the workspace or tenant. The credential reference to revoke, or null.
CREATE FUNCTION app_chat_install_remove(p_provider text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_install uuid;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_chat_admin_caller() c;
  SELECT i.id INTO v_install FROM chat_installs i WHERE i.organization_id = v_org AND i.provider = p_provider AND i.revoked_at IS NULL;
  IF v_user IS NULL OR v_install IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN coalesce(app_chat_install_end(v_install, 'ADMIN', v_user), '');
END
$$;

-- From a verified provider webhook: the app was uninstalled, or its tokens revoked. Sends stop at once.
-- The credential reference to destroy, or null when no live install matched.
CREATE FUNCTION app_chat_install_provider_event(p_provider text, p_tenant text, p_reason text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_install uuid;
BEGIN
  IF p_reason NOT IN ('UNINSTALLED', 'TOKENS_REVOKED') THEN
    RETURN NULL;
  END IF;
  SELECT i.id INTO v_install FROM chat_installs i WHERE i.provider = p_provider AND i.external_tenant = p_tenant AND i.revoked_at IS NULL;
  IF v_install IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN coalesce(app_chat_install_end(v_install, p_reason, NULL), '');
END
$$;

-- Any member of the signed-in organization: whether each platform is installed. The number of linked
-- members only for owners and admins. Never the workspace or tenant id.
CREATE FUNCTION app_chat_install_status() RETURNS TABLE (provider text, installed_at timestamptz, linked_count integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT i.provider, i.installed_at,
           CASE WHEN EXISTS (SELECT 1 FROM app_chat_admin_caller())
                THEN (SELECT count(*)::int FROM user_contact_channels ch WHERE ch.install_id = i.id AND ch.revoked_at IS NULL) END
      FROM chat_installs i
     WHERE i.organization_id = (SELECT c.organization_id FROM app_contact_caller() c) AND i.revoked_at IS NULL
     ORDER BY i.provider
  $$;

-- The caller's organization's live install, for the API to look the person up and send (never returned to a client).
CREATE FUNCTION app_chat_install_for_caller(p_provider text) RETURNS TABLE (install_id uuid, external_tenant text, credential_ref text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT i.id, i.external_tenant, i.credential_ref FROM chat_installs i
     WHERE i.organization_id = (SELECT c.organization_id FROM app_contact_caller() c)
       AND i.provider = p_provider AND i.revoked_at IS NULL
  $$;

-- From a verified Slack event or Teams activity: the live install for a workspace or tenant (home tab, replies).
CREATE FUNCTION app_chat_install_for_tenant(p_provider text, p_tenant text) RETURNS TABLE (install_id uuid, credential_ref text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT i.id, i.credential_ref FROM chat_installs i
     WHERE i.provider = p_provider AND i.external_tenant = p_tenant AND i.revoked_at IS NULL
  $$;

-- The person asks to link: a one-time confirmation for the platform member their verified email matched.
-- The member must belong to the caller's own organization's install. At most 5 per 15 minutes.
CREATE FUNCTION app_chat_link_begin(p_provider text, p_handle text, p_secret_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_id uuid := uuidv7();
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF v_user IS NULL OR p_provider NOT IN ('SLACK', 'TEAMS') OR NOT EXISTS (
    SELECT 1 FROM chat_installs i WHERE i.organization_id = v_org AND i.provider = p_provider AND i.revoked_at IS NULL
       AND i.external_tenant = split_part(p_handle, ':', 1)) THEN
    IF v_user IS NOT NULL THEN
      PERFORM app_chat_audit(v_org, v_user, v_user, 'contact.verification_requested', 'DENIED');
    END IF;
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM contact_verifications v
       WHERE v.user_id = v_user AND v.kind = p_provider AND v.created_at > now() - interval '15 minutes') >= 5 THEN
    PERFORM app_chat_audit(v_org, v_user, v_user, 'contact.verification_requested', 'DENIED');
    RETURN NULL;
  END IF;
  UPDATE contact_verifications SET expires_at = now()
   WHERE user_id = v_user AND kind = p_provider AND consumed_at IS NULL AND expires_at > now();
  INSERT INTO contact_verifications (id, organization_id, user_id, kind, target, secret_hash, expires_at)
  VALUES (v_id, v_org, v_user, p_provider, p_handle, p_secret_hash, now() + interval '10 minutes');
  PERFORM app_chat_audit(v_org, v_user, v_user, 'contact.verification_requested', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- From a verified Slack interaction or Teams activity: the member pressed Confirm. Only the member the
-- confirmation was sent to, within 10 minutes, once, and only while the install is live. The channel id, or null.
CREATE FUNCTION app_chat_link_confirm(p_provider text, p_handle text, p_secret_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row contact_verifications%ROWTYPE;
  v_install uuid;
  v_id uuid := uuidv7();
BEGIN
  SELECT * INTO v_row FROM contact_verifications v
   WHERE v.secret_hash = p_secret_hash AND v.kind = p_provider AND v.target = p_handle
     AND v.consumed_at IS NULL AND v.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT i.id INTO v_install FROM chat_installs i
   WHERE i.organization_id = v_row.organization_id AND i.provider = p_provider AND i.revoked_at IS NULL
     AND i.external_tenant = split_part(p_handle, ':', 1);
  IF v_install IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE contact_verifications SET consumed_at = now() WHERE id = v_row.id;
  UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE revoked_at IS NULL AND kind = p_provider AND (user_id = v_row.user_id OR handle = p_handle);
  INSERT INTO user_contact_channels (id, organization_id, user_id, kind, handle, verified_at, install_id)
  VALUES (v_id, v_row.organization_id, v_row.user_id, p_provider, p_handle, now(), v_install);
  PERFORM app_chat_audit(v_row.organization_id, v_row.user_id, v_row.user_id, 'contact.' || lower(p_provider) || '_connected', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- Whether a platform member is linked (the Slack home tab shows Disconnect only then).
CREATE FUNCTION app_chat_linked(p_provider text, p_handle text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (SELECT 1 FROM user_contact_channels ch WHERE ch.kind = p_provider AND ch.handle = p_handle AND ch.revoked_at IS NULL)
  $$;

-- Teams, from the verified install activity: where the person's chat with the bot lives.
CREATE FUNCTION app_teams_ref_capture(p_tenant text, p_aad text, p_email_hash text, p_service_url text, p_conversation text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO teams_conversation_refs (id, tenant_id, aad_object_id, email_hash, service_url, conversation_id)
    VALUES (uuidv7(), p_tenant, p_aad, p_email_hash, p_service_url, p_conversation)
    ON CONFLICT (tenant_id, aad_object_id) DO UPDATE
      SET email_hash = EXCLUDED.email_hash, service_url = EXCLUDED.service_url, conversation_id = EXCLUDED.conversation_id,
          captured_at = now(), removed_at = NULL
  $$;

-- Teams, from the verified activity: the person removed the app. Their link ends at once. How many links ended.
CREATE FUNCTION app_teams_ref_remove(p_tenant text, p_aad text) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  UPDATE teams_conversation_refs SET removed_at = now() WHERE tenant_id = p_tenant AND aad_object_id = p_aad AND removed_at IS NULL;
  FOR v_row IN
    UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'UNINSTALLED'
     WHERE kind = 'TEAMS' AND handle = p_tenant || ':' || p_aad AND revoked_at IS NULL RETURNING organization_id, user_id
  LOOP
    PERFORM app_chat_audit(v_row.organization_id, NULL, v_row.user_id, 'contact.teams_stopped', 'SUCCEEDED');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;

-- Teams, for the signed-in person: the conversation in their organization's tenant whose member email
-- hashes to theirs. Nothing when the organization has no Teams install or the app is not installed for them.
CREATE FUNCTION app_teams_ref_for_caller(p_email_hash text) RETURNS TABLE (aad_object_id text, service_url text, conversation_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT r.aad_object_id, r.service_url, r.conversation_id FROM teams_conversation_refs r
      JOIN chat_installs i ON i.provider = 'TEAMS' AND i.external_tenant = r.tenant_id AND i.revoked_at IS NULL
     WHERE i.organization_id = (SELECT c.organization_id FROM app_contact_caller() c)
       AND r.email_hash = p_email_hash AND r.removed_at IS NULL
     ORDER BY r.captured_at DESC LIMIT 1
  $$;

-- Teams, from a verified activity: one member's conversation (to answer a Confirm or Disconnect in their chat).
CREATE FUNCTION app_teams_ref_for_member(p_tenant text, p_aad text) RETURNS TABLE (service_url text, conversation_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT r.service_url, r.conversation_id FROM teams_conversation_refs r
     WHERE r.tenant_id = p_tenant AND r.aad_object_id = p_aad AND r.removed_at IS NULL
  $$;

-- Where each live Slack or Teams link sends: the dispatcher's list, and the person's own test message.
-- Only links whose install is live; Teams only while the conversation is.
CREATE FUNCTION app_chat_dispatch_targets(p_users uuid[])
  RETURNS TABLE (channel_id uuid, user_id uuid, kind text, handle text, credential_ref text, service_url text, conversation_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT ch.id, ch.user_id, ch.kind, ch.handle, i.credential_ref, r.service_url, r.conversation_id
      FROM user_contact_channels ch
      JOIN chat_installs i ON i.id = ch.install_id AND i.revoked_at IS NULL
      LEFT JOIN teams_conversation_refs r ON ch.kind = 'TEAMS' AND r.tenant_id = i.external_tenant
                                          AND r.aad_object_id = split_part(ch.handle, ':', 2) AND r.removed_at IS NULL
     WHERE ch.user_id = ANY (p_users) AND ch.revoked_at IS NULL AND ch.kind IN ('SLACK', 'TEAMS')
       AND (ch.kind = 'SLACK' OR r.id IS NOT NULL)
     ORDER BY ch.user_id, ch.kind
  $$;

CREATE FUNCTION app_chat_target_for_caller(p_channel uuid)
  RETURNS TABLE (channel_id uuid, user_id uuid, kind text, handle text, credential_ref text, service_url text, conversation_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT t.* FROM app_contact_caller() c, app_chat_dispatch_targets(ARRAY[c.user_id]) t
     WHERE t.channel_id = p_channel
       AND EXISTS (SELECT 1 FROM user_contact_channels ch WHERE ch.id = p_channel AND ch.organization_id = c.organization_id)
  $$;

-- Owners and admins: which members are linked on a platform, by name. Never a platform user id. Audited.
CREATE FUNCTION app_chat_admin_members(p_provider text, p_after uuid, p_limit integer)
  RETURNS TABLE (user_id uuid, display_name text, linked boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_org uuid;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_chat_admin_caller() c;
  IF v_user IS NULL THEN
    SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
    IF v_user IS NOT NULL AND v_org IS NOT NULL THEN
      PERFORM app_chat_audit(v_org, v_user, v_user, 'contact.admin_viewed', 'DENIED');
    END IF;
    RETURN;
  END IF;
  PERFORM app_chat_audit(v_org, v_user, v_user, 'contact.admin_viewed', 'SUCCEEDED');
  RETURN QUERY
    SELECT u.id, u.display_name,
           EXISTS (SELECT 1 FROM user_contact_channels ch JOIN chat_installs i ON i.id = ch.install_id AND i.revoked_at IS NULL
                    WHERE ch.user_id = u.id AND ch.organization_id = v_org AND ch.kind = p_provider AND ch.revoked_at IS NULL)
      FROM organization_memberships m
      JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = v_org AND m.status = 'ACTIVE' AND (p_after IS NULL OR u.id > p_after)
     ORDER BY u.id
     LIMIT least(greatest(p_limit, 1), 101);
END
$$;

-- Unchanged for Telegram and WhatsApp; a Slack or Teams send also leaves its outcome in the audit log (no content).
CREATE OR REPLACE FUNCTION app_contact_delivery_finish(p_delivery uuid, p_outcome text, p_error_class text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_channel record;
BEGIN
  UPDATE contact_channel_deliveries SET outcome = p_outcome, error_class = p_error_class, finished_at = now()
   WHERE id = p_delivery AND outcome = 'CLAIMED' AND p_outcome IN ('SENT', 'FAILED');
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT ch.organization_id, ch.user_id, ch.kind INTO v_channel
    FROM contact_channel_deliveries d JOIN user_contact_channels ch ON ch.id = d.channel_id WHERE d.id = p_delivery;
  IF v_channel.kind IN ('SLACK', 'TEAMS') THEN
    PERFORM app_chat_audit(v_channel.organization_id, NULL, v_channel.user_id,
      'contact.' || lower(v_channel.kind) || CASE p_outcome WHEN 'SENT' THEN '_delivered' ELSE '_delivery_failed' END,
      CASE p_outcome WHEN 'SENT' THEN 'SUCCEEDED' ELSE 'FAILED' END);
  END IF;
  RETURN true;
END
$$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_chat_audit(uuid, uuid, uuid, text, text)',
    'app_chat_admin_caller()',
    'app_chat_install_end(uuid, text, uuid)',
    'app_chat_install_save(text, text, text)',
    'app_chat_install_remove(text)',
    'app_chat_install_provider_event(text, text, text)',
    'app_chat_install_status()',
    'app_chat_install_for_caller(text)',
    'app_chat_install_for_tenant(text, text)',
    'app_chat_link_begin(text, text, text)',
    'app_chat_link_confirm(text, text, text)',
    'app_chat_linked(text, text)',
    'app_teams_ref_capture(text, text, text, text, text)',
    'app_teams_ref_remove(text, text)',
    'app_teams_ref_for_caller(text)',
    'app_teams_ref_for_member(text, text)',
    'app_chat_dispatch_targets(uuid[])',
    'app_chat_target_for_caller(uuid)',
    'app_chat_admin_members(text, uuid, integer)',
    'app_contact_delivery_finish(uuid, text, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'app_chat_install_save(text, text, text)',
    'app_chat_install_remove(text)',
    'app_chat_install_provider_event(text, text, text)',
    'app_chat_install_status()',
    'app_chat_install_for_caller(text)',
    'app_chat_install_for_tenant(text, text)',
    'app_chat_link_begin(text, text, text)',
    'app_chat_link_confirm(text, text, text)',
    'app_chat_linked(text, text)',
    'app_teams_ref_capture(text, text, text, text, text)',
    'app_teams_ref_remove(text, text)',
    'app_teams_ref_for_caller(text)',
    'app_teams_ref_for_member(text, text)',
    'app_chat_dispatch_targets(uuid[])',
    'app_chat_target_for_caller(uuid)',
    'app_chat_admin_members(text, uuid, integer)',
    'app_contact_delivery_finish(uuid, text, text)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
