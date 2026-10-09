# Runbook — Pactlab GitHub App

Pactlab reads sellers' repositories through one read-only GitHub App that
Pactlab owns. Sellers install it on the repositories they choose; Pactlab
never receives their passwords or tokens. (Sellers who can't install apps
can paste a fine-grained token instead — see "Token fallback".)

## Register the App (once per environment)

1. GitHub → your organization (or account) → **Settings → Developer settings
   → GitHub Apps → New GitHub App**.
2. Name: `Pactlab` (local/dev: `Pactlab Dev`). Homepage URL: `https://pactlab.ai`.
3. **Webhook:** untick *Active*. Pactlab does not use webhooks.
4. **Repository permissions:** *Contents → Read-only*. *Metadata → Read-only*
   is added automatically. Leave everything else at *No access*.
5. **Where can this GitHub App be installed?** *Any account* (sellers install
   it on their own organizations).
6. Create the App, then note the **App ID** and the **slug** (the last part of
   `https://github.com/apps/<slug>`).
7. **Generate a private key.** GitHub downloads a PKCS#1 PEM. Convert it once:

   ```bash
   openssl pkcs8 -topk8 -nocrypt -in pactlab.private-key.pem -out pactlab.pk8.pem
   ```

   Keep the key outside the repository (for example `~/.pactlab/`), owner-only
   permissions (`chmod 600`). Never commit it, paste it into chat or put it in
   `.env.example`.

## Configure the API (local)

In the root `.env`:

```bash
GITHUB_APP_ID=<numeric id>
GITHUB_APP_SLUG=<slug>
GITHUB_APP_PRIVATE_KEY_PATH=/Users/<you>/.pactlab/pactlab.pk8.pem
LOCAL_SECRETS_DIR=.data/secrets
LOCAL_SECRETS_KEY=<openssl rand -base64 32>
```

Restart the API. `GET /v1/github/app` now returns the install URL, and the
Code card's **Connect GitHub API** offers the App.

## Connect a repository

1. Deal → Sources → Code → **Connect GitHub API** → *Pactlab GitHub App*.
2. The seller's GitHub admin opens **Install the Pactlab GitHub App**, picks
   the organization and **Only select repositories**.
3. Enter `owner/name` → **Connect and check**. All four checks should read OK
   (contributor map is "Not checked" until the seller supplies one).
4. **Sync now** records the repository head as evidence.

Each request uses an installation token narrowed to that one repository with
`contents:read`/`metadata:read`, held in memory for under an hour.

## Token fallback

The seller creates a fine-grained token (resource owner: their organization;
only the one repository; *Contents: Read-only*) and pastes it on the connect
screen. It is stored encrypted (`LOCAL_SECRETS_*` locally; Secrets Manager in
deployed environments, T-007) and never displayed or logged again.

## Revoke

- App: the seller uninstalls the App or removes the repository from it on
  GitHub; the next sync fails with a clear "not installed" check.
- Token: the seller deletes the token on GitHub.
- Pactlab side: rotate the App's private key in the App settings and update
  `GITHUB_APP_PRIVATE_KEY_PATH`.

## Re-record test cassettes

Cassettes come from the public `octocat/Hello-World` repository, scrubbed of
personal data, and CI replays them offline:

```bash
pnpm --filter @pactlab/connectors cassettes:record:github
pnpm --filter @pactlab/connectors test   # the sanitizer test must pass
```
