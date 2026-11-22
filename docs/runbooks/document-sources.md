# Document sources: Google Drive and OneDrive / SharePoint sign-in (T-147, ADR 0038)

People connect folders in either of two ways, both read-only:
- **From the pact (the usual way):** anyone who supplies documents, the deal team or the seller, opens the pact's **Documents → Data room**, pastes the folder link and clicks **Sign in with Google / Microsoft**. They come back signed in and the folder reads in. A seller's files are shared with the deal team.
- **For the whole organization:** an owner or admin signs in once in **Settings → Document sources**, and the deal team can then pick **Use the organization's Google Drive** on any pact.

Both use the same Pactlab OAuth clients and the same redirect URIs below; nothing extra is registered. This runbook registers Pactlab's OAuth clients, once per provider. Each client serves every environment through its redirect URIs.

## Redirect URIs
| Environment | Google Drive | OneDrive / SharePoint |
|---|---|---|
| live | `https://app.pactlab.ai/settings/document-sources/google-drive/callback` | `https://app.pactlab.ai/settings/document-sources/onedrive/callback` |
| stage, qa, dev | the same path on that environment's web origin (`APP_WEB_ORIGIN`) | the same |
| local | `http://localhost:3000/settings/document-sources/google-drive/callback` | `http://localhost:3000/settings/document-sources/onedrive/callback` |

## Google Drive (Google Cloud console, the Pactlab project)
1. **APIs & Services → Library:** enable the **Google Drive API**.
2. **Google Auth Platform → Branding:**
   - app name **Pactlab**, with support email and logo;
   - authorized domain **pactlab.ai**;
   - links to the privacy policy and terms.
3. **Data access:** add the scope `https://www.googleapis.com/auth/drive.readonly`, and nothing else. It's a restricted scope, so Google asks for verification before the app is public. Until verification passes, use **Audience → Testing** with the test users who will connect.
4. **Clients → Create client → Web application:** add the redirect URIs above, then copy the **client id** and **client secret**.
5. **Store them:** run `scripts/doc-source-key.sh live google`; it asks for both, with the secret hidden. Repeat per environment.

## OneDrive / SharePoint (Microsoft Entra admin center)
1. **App registrations → New registration:**
   - name **Pactlab**;
   - supported accounts **Accounts in any organizational directory and personal Microsoft accounts**;
   - redirect platform **Web**, with the URIs above.
2. **API permissions → Microsoft Graph → Delegated:** `Files.Read.All`, `offline_access` and `User.Read`. These are read-only, and none needs admin consent. Remove anything else.
3. **Certificates & secrets → New client secret.** Note its expiry, and set a reminder to rotate it before then.
4. **Store them:** copy the **Application (client) id** and the secret **value**, then run `scripts/doc-source-key.sh live microsoft`.

## After setting
- **The script restarts the API.** Settings → Document sources then shows **Connect Google Drive** or **Connect OneDrive / SharePoint**. A provider whose values are `unset` is hidden.
- **Turning a provider off:** run `scripts/doc-source-key.sh live google off`. Existing sign-ins stop reading, and their sources show Reconnect needed.

## Where things live
- **Pactlab's client ids and secrets:** Secrets Manager `pactlab/<env>/documents/{google,microsoft}-client-{id,secret}`.
- **Each organization's sign-in:** Secrets Manager `pactlab/<env>/credentials/<org>/<provider>/<connection>`, holding access and refresh tokens. It's never returned by an API, logged or audited, and is deleted on disconnect.

## Troubleshooting
- **"Pactlab could not sign in to this source":**
  - the sign-in was revoked at the provider, or the connecting person lost access to the folder;
  - an owner or admin reconnects in Settings, and every pact's sources follow.
- **Google says the app isn't verified:** add the person as a test user, or finish verification.
