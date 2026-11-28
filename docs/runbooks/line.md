# LINE: pact alerts on LINE for Japan (T-182, ADR 0066)

Off by default. Agents never set these values or touch AWS, LINE Developers or LINE Official Account Manager; these are Kumar's steps.

## Cost (read 2026-11-27, lycbiz.com/jp/service/line-official-account/plan/)
| Plan (Japan) | Monthly fee (tax excluded) | Messages included a month | Extra messages |
|---|---|---|---|
| コミュニケーションプラン (Communication) | ¥0 | 200 | not available |
| ライトプラン (Light) | ¥5,000 | 5,000 | not available |
| スタンダードプラン (Standard) | ¥15,000 | 30,000 | about ¥3 each, tiered (revised 2026-10-01; tiers are on the page as an image) |

- **Counted:** push, multicast, broadcast and narrowcast messages (messages × recipients). **Not counted:** reply messages (developers.line.biz, Messaging API pricing). Pactlab sends alerts and test messages as push, and every reply in the chat (connected, not connected, stopped) as a reply.
- **Pactlab runs on the free Communication plan.** Sends stop at 200 a month (calendar month, Japan time); the person still gets the email for the same alert, and the operator console shows **LINE monthly allowance reached**. LINE's own "You have reached your monthly limit." stops the month the same way.
- **A paid plan is a paid dependency** (CLAUDE.md): record Kumar's approval in `tasks/…/T-182.md` first. The ceiling is the code constant `LINE_FREE_MONTHLY_ALLOWANCE` (`apps/api/src/contacts/line-sender.ts`); `LINE_MONTHLY_ALLOWANCE` can only lower it. Raising it is a code change after the approval.

## One-time setup (Kumar)
1. **LINE Official Account.** Create it in LINE Official Account Manager (manager.line.biz), Japan region.
2. **Branding** (LINE Official Account Manager → the account's profile; the same identity as the emails):
   - **Account name:** `Pactlab`.
   - **Profile image:** `apps/api/assets/brand/pactlab-icon.png` (the icon the emails and the site use; never a new drawing).
   - **Status message:** `Test the pact before you sign it.` (`EMAIL_BLURB`, the tagline).
   - Turn **auto-response messages off** and **webhooks on** (Response settings), so only Pactlab answers in the chat.
3. **Messaging API channel.** In Manager, enable the Messaging API and choose a **provider** (e.g. "Pactlab"). In LINE Developers (developers.line.biz/console), that channel's:
   - **Channel secret** (Basic settings) → `LINE_CHANNEL_SECRET`;
   - **Channel access token (long-lived)** (Messaging API tab, Issue) → `LINE_CHANNEL_ACCESS_TOKEN`;
   - **Webhook URL:** `https://app.pactlab.ai/v1/webhooks/line`, **Use webhook** on, then **Verify** (LINE sends an empty event list; Pactlab answers 200 once the secret is set).
4. **LINE Login channel, under the same provider.** The user ID is the same in both channels only when they share a provider.
   - **Channel ID** → `LINE_LOGIN_CHANNEL_ID`; **Channel secret** → `LINE_LOGIN_CHANNEL_SECRET`.
   - **Callback URL:** `https://app.pactlab.ai/settings/profile/line/callback` (and the dev or stage host where it is tested).
   - **Linked LINE Official Account** (Basic settings): the Pactlab account, so LINE Login offers "add as friend" (`bot_prompt=aggressive`).
   - Same branding: app name `Pactlab`, icon `pactlab-icon.png`, description `Test the pact before you sign it.`
   - Publish the channel (Developing → Published) once tested.
5. **Add-friend link** (optional): Manager → Add friends → the URL (`https://lin.ee/…`) → `LINE_ADD_FRIEND_URL`. Shown on the profile when someone skipped the add-friend screen.
6. **Secrets:** put the four values (and the link) in Secrets Manager for the environment and pass them to the API task as environment variables. The CDK wiring is a follow-up in `infra/cdk` (with T-146's channel secrets); until then set them on the task. All four or none: a partial set stops the API at startup.
7. **Check:** Your profile → **Connect LINE** → agree → add Pactlab as a friend → "Pactlab: You are connected." in LINE → **Send a test message**. Operator console → Health shows "LINE this month: 1 of 200".

## How it works
- **Linking:** LINE Login (`openid profile`, `bot_prompt=aggressive`) → the API verifies the ID token (`/oauth2/v2.1/verify`, audience and nonce) and asks `/friendship/v1/status`. A friend already: connected. Not yet: pending for 15 minutes until the account's signed `follow` webhook arrives. No LINE token is kept.
- **Disconnect:** Your profile, sending STOP (or 停止, ストップ, 配信停止) in the chat, or blocking the account (`unfollow`). Blocking disconnects at once and sends nothing.
- **Messages:** content-free, always "Pactlab:" first; English then Japanese (the server does not know a person's language yet, T-172b), Japanese only once it does. Every push carries `X-Line-Retry-Key` (the delivery's id), so LINE accepts it at most once.
- **Japanese wording** in `packages/domain/src/contacts/index.ts` was written in the build and **needs a native speaker's review** before Japan launch.

## When something is wrong
- **"LINE monthly allowance reached" in the console:** expected on the free plan once 200 pushes went out this month. People still get email. It clears on the 1st (Japan time). To raise it, see Cost.
- **Webhook Verify fails in LINE Developers:** check `LINE_CHANNEL_SECRET` is the Messaging API channel's (not LINE Login's) and the URL is `/v1/webhooks/line`. A wrong signature answers 403.
- **Connect LINE says the sign-in did not finish:** check the Login channel's callback URL matches the host exactly, and `LINE_LOGIN_CHANNEL_*`.
- **Connected in LINE Login but never connected in Pactlab:** the person did not add the account within 15 minutes, or the Login channel and Messaging API channel are under different providers (different user IDs). Connect again.
- **Rotating:** issue a new channel access token or secret in LINE Developers, set it, redeploy. **Turning off:** unset the four values and redeploy; linked channels stay recorded but nothing is sent.

## Data rules
A LINE user ID is personal data: stored only on the person's own channel row (RLS by user and organization), masked for admins (`LINE ••3f`), never logged, never in a fixture (tests use made-up IDs), never sent to a model. Changes are audited (`contact.line_connected`, `contact.line_disconnected`, `contact.line_stopped`).
