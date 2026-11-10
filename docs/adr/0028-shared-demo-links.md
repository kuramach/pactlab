# ADR 0028: Shared demos: a pool of demo organizations lent through magic links (T-113)

**Status:** accepted (Kumar, 2026-11-10)

## Context
- **The problem:** demos need a full Pactlab a prospect can open without signing up or waiting for a code.
- **The request** (Kumar): five demo accounts, shared through links with buyer and seller roles, from the admin console, for a set time. When the time is up, the data goes back to the original demo and the account is free for the next share.
- **Kumar's choices:**
  - visitors may do everything except outward actions;
  - share lengths of 1 day, 3 days or 1 week;
  - buyer and seller links.

## Decision
- **The pool:** five organizations, "Pactlab Demo 1–5 (synthetic)" (`created_via = DEMO`).
  - **Contents:** each is built by the same code as the owner's demo organization (`runDemoOrg`, PR #174), with its own fixed ids (`demoPoolSpec`).
  - **People:** the buyer, seller, reviewer, analyst and bidders have **no email address**, so no code or email can ever reach them.
- **Tracking:** `demo_slots` (AVAILABLE, SHARED or RESETTING) and `demo_shares` (who for, until when, the two links as SHA-256 hashes) are reached only through SECURITY DEFINER functions.
  - **Operators** (`app_ops_demo_*`, which check `platform_operator`) list, share, end, and queue a reset.
  - **`pactlab_auth`** (`app_demo_link_login`) turns a live link into a session.
- **A magic link is a sign-in method, scoped tightly:**
  - **The token:** 256 random bits, shown to the operator once.
  - **The session:** it signs in only as that slot's buyer or seller, in that slot's organization. It ends at the share's end, or after 12 hours (opening the link again starts a fresh one).
  - **The share's end ends everything:** `app_auth_session_check` refuses a demo-link session once its share has ended or expired, so ending a share stops its sessions on the next request.
- **Outward actions are refused** to demo-link sessions with 422 `DEMO_NOT_AVAILABLE` (`@NoDemo()`, checked in the auth guard):
  - invitations (pact and bidder);
  - DocuSign connect and send;
  - OAuth consent for AI assistants;
  - live GitHub or Jira connections;
  - billing checkout, portal and promo codes;
  - passkeys;
  - deleting a pact;
  - the session limit.

  Everything inside a pact stays open, because it is all rebuilt.
- **Reset:** an EventBridge rule on live runs the seed task every 15 minutes with `src/ops/demo-pool.ts sweep`. The sweep:
  1. creates any missing slot;
  2. ends shares whose time is up (with their sessions);
  3. rebuilds every RESETTING slot with `runDemoOrg --reset`: pacts deleted through the deletion service and rebuilt, entered comparables retired and re-entered, organization settings restored. Then it marks the slot AVAILABLE, or records `last_error` and retries.

  An operator's "End now" queues the slot for the next sweep.

## Consequences
- **Sign-in without a code:** a forwarded link gives whoever holds it the demo until the share ends. That is the point of a shared demo, and it is bounded:
  - synthetic data only;
  - no outward actions;
  - one slot per share;
  - "End now" stops it within one request.
- **Rebuild cost:** a rebuild takes a few minutes of the seed task, which is idle otherwise. Stage pauses when idle, so there the sweep runs by hand.
- **Rollback:** the migration `20261203000000_demo_shares` is expand-only. Drop the functions, the two tables and `auth_sessions.demo_share_id`, and restore `app_auth_session_check` from `20261202000000_trusted_sessions`.
