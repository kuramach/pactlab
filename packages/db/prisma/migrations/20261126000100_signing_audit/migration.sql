-- T-107: the e-signature webhook function (app_signing_record, owned by pactlab_auth) audits
-- each envelope outcome on the deal's chain. pactlab_auth is reached only through definer
-- functions; it may append just these three events, and read the chain only on deals that
-- use e-signature (the chain trigger reads the deal's last link). Rollback: drop both policies.
CREATE POLICY audit_events_auth_signing_insert ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NOT NULL AND actor_user_id IS NULL AND target_type = 'signature_envelope'
              AND action IN ('terms.esign_completed', 'terms.esign_declined', 'terms.esign_voided'));
CREATE POLICY audit_events_auth_signing_select ON audit_events FOR SELECT TO pactlab_auth
  USING (deal_id IS NOT NULL AND EXISTS (SELECT 1 FROM signature_envelopes e WHERE e.deal_id = audit_events.deal_id));
