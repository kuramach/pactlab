# Pactlab signing (BoldSign) (T-136, ADR 0036)

Pactlab signing sends letters of intent and agreed terms from **Pactlab's own BoldSign account**. Signers sign inside Pactlab in an embedded BoldSign session. An organization may instead choose its own connected DocuSign (Settings → Signing; see `docusign.md`).

## 1. The BoldSign account
- **Until the production go:** a free **sandbox** account (no card). Sandbox documents are test documents.
- **Production** is a later, separate go: the API plan at $30/mo with 40 envelopes, then $0.75 each, pay-as-you-go.
- **API key:** BoldSign → Settings → API Keys. US region: API origin `https://api.boldsign.com`. Another region sets `BOLDSIGN_API_BASE_URL`.

## 2. Local (the Mac clone's `apps/api/.env`)
```
SIGNING_PROVIDER=boldsign,fixture
BOLDSIGN_API_KEY=<sandbox key>
SIGNING_TEST_RECIPIENTS=<your own addresses or @domain, comma-separated>
```
- **Without a webhook:** locally there is no public endpoint, so the polling fallback carries status: each open envelope is checked when its pact is opened (at most once a minute), and by the worker's sweep (below).
- **Fails closed:** the API refuses to start with a key and no test recipients.

## 3. A deployed environment (live included, sandbox key)
```
scripts/signing-key.sh live recipients   # your own addresses first
scripts/signing-key.sh live key          # the sandbox API key
```
- **Defaults:** `SIGNING_PROVIDER` comes from `infra/cdk/config/<env>.ts`: `boldsign` on live, and `boldsign,fixture` elsewhere (test signing until a key is set).
- **The webhook,** once the environment is public:
  1. BoldSign → API → Webhooks → add an app webhook to `https://<app host>/v1/webhooks/signing/boldsign`, for the document events Sent, Viewed, Completed, Declined, Expired, Revoked and SendFailed. BoldSign sends a `Verification` request, which Pactlab answers 200.
  2. Reveal the signing secret, then run `scripts/signing-key.sh live webhook`.

## 4. Smoke test (live, after deploy)
1. In a pact with agreed terms, draft the letter of intent, fill the governing law, and **Send by e-signature**. Both signatories must be test recipients.
2. The buyer signatory opens Letter of intent → E-signature → **Sign now** and signs in the embedded session; then the seller (a guest) does the same.
3. Check the timeline shows Sent → Opened → Signed by both sides, and the letter is countersigned.
4. Download the **signed document** and the **certificate of completion**.
5. Confirm the signature field sits on the signature line. If it doesn't, the `{{sign|n|*}}` marker size in `loi-pdf.ts` and `term-sheet.ts` needs adjusting.

## 5. Polling cadence (T-144)
- **The sweep:** the worker runs `signing.poll-sweep` every 15 minutes, with no page open. It polls each open (Sent or Delivered) BoldSign envelope through the signing seam and records what it finds with the same idempotent recorder the webhook uses, so a webhook and a poll for one event apply once.
- **Bounded:** 50 envelopes a page, 10 pages a run, in id order; an envelope checked in the last 7 minutes (by a page load or the last sweep) is skipped. A backlog drains over the next runs.
- **Needs** `BOLDSIGN_API_KEY` (and `BOLDSIGN_API_BASE_URL`) in the worker's environment, as in the API's. Without it the sweep skips BoldSign envelopes. An organization's own DocuSign is not swept (it needs that organization's token): opening its pact still polls it.
- **Signed files** are collected when the pact is opened, as before.

## A stuck envelope
- **What it looks like:** still Sent or Delivered after the signers say they signed, and a `signing.poll_failed` audit event on the pact (at most one a day per envelope). The Audit log shows it.
- **Check:** the worker log for `job failed` on `signing.poll-sweep`; the BoldSign key (rotated or `unset`?); BoldSign's status page.
- **Fix:** correct the key or wait for BoldSign; the next sweep (15 minutes) or opening the pact picks the envelope up. Nothing is lost: status only moves forward, and each event applies once.

## When something goes wrong
- **"test recipients only":** a signatory's address isn't in `SIGNING_TEST_RECIPIENTS`. Nothing was sent. Add the address (step 3) or sign in Pactlab.
- **Stuck at Sent:** the webhook isn't registered or its secret is wrong (webhooks answer 403). Polling still converges within one sweep (15 minutes), or at once when the pact is opened.
- **"Signed files are not stored yet":** BoldSign's download failed. Opening the pact retries it; nothing is lost.
- **Stop sending:** `scripts/signing-key.sh <env> key off`.
