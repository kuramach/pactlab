# DocuSign e-signature (T-107, ADR 0022)

Customers sign from **their own** DocuSign accounts. Pactlab only registers an app, its integration key, that their accounts connect to. Pactlab never sends envelopes from an account of its own.

## 1. Register Pactlab's app (once per DocuSign environment)

1. Sign in to a DocuSign developer account (free): https://developers.docusign.com
2. Open **Apps and Keys** → **Add App and Integration Key**, and name it "Pactlab".
3. **Authentication:** User Application, **Authorization Code Grant**. Add a **secret key**.
4. **Redirect URIs:** one per Pactlab environment:
   - `http://localhost:3000/settings/docusign/callback`
   - `https://dev.pactlab.ai/settings/docusign/callback`
   - `https://app.stage.pactlab.ai/settings/docusign/callback`
   - `https://app.pactlab.ai/settings/docusign/callback`
5. **Connect** (Settings → Connect → Add configuration):
   - **Target URL:** `https://<api-origin>/v1/webhooks/signing/docusign`
   - **Format:** JSON (SIM).
   - **Events:** Envelope Completed, Declined and Voided.
   - **HMAC:** enable it and copy the key.
6. **Production:** apps start in DocuSign's developer environment (`account-d.docusign.com`). Before customers on production DocuSign accounts can connect, the app goes through DocuSign's **go-live review**. After that, set `DOCUSIGN_AUTH_HOST=account.docusign.com`.

## 2. Configure a Pactlab environment

Set all four, or none:

| Variable | Value |
|---|---|
| `DOCUSIGN_INTEGRATION_KEY` | The app's integration key |
| `DOCUSIGN_CLIENT_SECRET` | The app's secret key |
| `DOCUSIGN_AUTH_HOST` | `account-d.docusign.com` (developer) or `account.docusign.com` (production) |
| `DOCUSIGN_CONNECT_HMAC_KEY` | The Connect HMAC key |

**Token storage:** connected accounts' tokens live in the secret store.
- **Locally:** set `LOCAL_SECRETS_DIR` and `LOCAL_SECRETS_KEY`.
- **Deployed environments:** they need Secrets Manager (T-007). Until then, connecting fails closed, and pacts sign off in Pactlab.

## 3. Connect an organization

An organization owner or admin opens **Settings → E-signature (DocuSign) → Connect DocuSign**, signs in to DocuSign and grants access. Pactlab records the default account.

**Disconnect** stops new envelopes. Envelopes already sent keep their outcome.

## 4. Without DocuSign

Outside production, **test e-signature** (the fixture) stands in: each signatory signs on the Closing tab. In production, without a connected account, signatories sign off in Pactlab.
