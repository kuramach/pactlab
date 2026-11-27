#!/usr/bin/env bash
# T-178b: load the Pactlab Rinse signing identities into the `rinse-release` GitHub Environment.
# Run by Kumar once the Apple Developer Program membership and the Azure Artifact Signing (Basic)
# account exist (ADR 0059, decision 2). Values are read from the terminal, never echoed or written to disk.
# Requires: gh (authenticated with admin on the repository).
set -euo pipefail
ENV=rinse-release
gh api -X PUT "repos/{owner}/{repo}/environments/$ENV" >/dev/null
secret() { read -r -s -p "$1 (blank to skip): " value; echo; [ -z "$value" ] || gh secret set "$1" --env "$ENV" --body "$value"; }
variable() { read -r -p "$1 (blank to skip): " value; [ -z "$value" ] || gh variable set "$1" --env "$ENV" --body "$value"; }

echo "macOS: Developer ID Application certificate (.p12, base64), its password and identity; notarization Apple ID."
secret APPLE_CERTIFICATE
secret APPLE_CERTIFICATE_PASSWORD
secret APPLE_SIGNING_IDENTITY
secret APPLE_ID
secret APPLE_PASSWORD
secret APPLE_TEAM_ID
echo "Windows: Azure Artifact Signing (endpoint, account, certificate profile) and a service principal allowed to sign."
variable AZURE_ARTIFACT_SIGNING_ENDPOINT
variable AZURE_ARTIFACT_SIGNING_ACCOUNT
variable AZURE_ARTIFACT_SIGNING_PROFILE
secret AZURE_CLIENT_ID
secret AZURE_CLIENT_SECRET
secret AZURE_TENANT_ID
echo "Updater: generate with 'npx @tauri-apps/cli@2 signer generate -w ~/.tauri/pactlab-rinse.key', keep the private key offline too."
secret TAURI_SIGNING_PRIVATE_KEY
secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD
variable RINSE_UPDATER_PUBKEY
echo "Done. Dispatch the rinse-desktop workflow; each build's SIGNING.json says what was signed."
