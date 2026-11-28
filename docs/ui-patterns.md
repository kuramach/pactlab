# Approved UI patterns

**The rule (Kumar, 2026-11-25):**
- Once a UI pattern is approved, every similar screen uses the same one.
- Look for an entry below before building anything that resembles it.
- If one exists, build from its component, unchanged.
- If none does, build one and ask Kumar to approve it before it spreads, then add it here.
- Never restyle an approved pattern locally: change the shared component, and every use changes together.

| Pattern | Use for | Component | Approved |
|---|---|---|---|
| **Step panel** | Stepping through items one at a time: the guided tour, What's new on the home and behind the icon, any carousel or walkthrough | `StepPanel` (`@pactlab/ui`). It has an icon on the left, then "Label · 2 of 5" before the title, then the text. Back, Next and dismiss are buttons inside the panel on the right; Back is outline, Next is primary, dismiss is a ghost X. | 2026-11-25, the guided tour's design |
| **Buttons** | Every button | `Button` (`@pactlab/ui`). Raw `<button>` only where `apps/web/lib/buttons.test.ts` allows it. | T-125 |
| **Provenance badges** | Source evidence, deterministic calculations, model drafts and reviewed decisions | `Badge` variants `evidence`, `calculation`, `draft`, `reviewed` | T-006 |
| **Lists and paging** | Any list that can grow | the shared `Pager`, with the position in the URL (CLAUDE.md, T-126) | T-126 |
| **Read-back cards** | AI that says how it read a file before acting, then what it picked up | the import reading and results cards, and the document extraction assistant: "Here's how Pactlab read…" with "Yes / Not quite", then "What Pactlab picked up" with "Where it shows" | 2026-11-25 |
| **Chat icon** | Every chat button or avatar (site and app) | `ChatMark` (`@pactlab/ui`, subpath `@pactlab/ui/chat-mark` for the site): the speaking flask, one SVG drawing. `placement` is where the chat sits; the face looks into the page (right-side placement → left-facing, left-side → right-facing). `compact` is the simplified drawing for 24 px and below. References: `docs/brand/chat-icon*.webp`, never shipped. | 2026-11-27 (T-186) |

The live examples are on `/design-system`.

## Awaiting approval

- **Help chat panel** (T-175): `HelpChat` (`apps/web/app/_components/help-chat`), the same on the site's `/assistant` window and docked from the app's **?** button. It holds the question box, answers with numbered steps, a deep link and "From:" sources, and the confirm step before anything is emailed or logged. Not yet approved by Kumar; not to be reused for other chat-like screens until it is.
- **Rinse bench** (T-178): `RinseScreen` and `FlaskMark` (`apps/desktop/src/ui`). The animated flask header (working while a rinse runs, still when clean, reduced motion honoured), the navy set card with the one upload action, the review queue with mismatches side by side (original, converted, page on each side), and the checklist of what the pact expects with "Add the file", "Enter by hand" and "Not applicable". It reuses `Button` unchanged. T-178d adds a "Where it goes" block to the set card: destination buttons (a folder, OneDrive, Google Drive, Box) and the seller's own sign-in for a drive. T-178e adds the window around it (`apps/desktop/src/ui/app.tsx`): the sign-in and set-up cards, and the hand-entry and gap-note panels, built from `Button` and plain labelled fields. Not yet approved by Kumar.
- **Criticals panel** (T-179): the pact's Criticals tab (`apps/web/app/(app)/deals/[dealId]/criticals`) and Settings → Deal criticals. Rows grouped by origin (*Org standard*, *This pact*); per row the organization's words, the confirmed threshold (with "Org standard: … — this pact: … (override, reason recorded)"), the rating badge, policy-breach, stale and older-version badges, the figures by year with their outcome, the formula, links to the source rows, the finding and the cited pages, and "Ask the seller" on No evidence; the shared `StructureFields` form for confirming a structure. Reuses `Badge`, `Button` and `Card` unchanged. Not yet approved by Kumar.
- **Your profile and the add-your-email banner** (T-180): `apps/web/app/(app)/settings/profile` and `apps/web/app/(app)/_lib/email-banner.tsx`. One card per contact (name, email, Telegram, WhatsApp), each with its verified state, its one action (send a code, Connect Telegram, send a code on WhatsApp with the country picker and the consent box) and, once connected, "Send a test message" and "Disconnect"; for admins, members' masked details with the shared `Pager`. Built from `Card`, `Button`, `PageHeader` and `Pager` unchanged; the banner reuses the shared-demo notice's look. Not yet approved by Kumar.
- **Slack and Teams cards** (T-181): on Your profile, one card each for Slack and Microsoft Teams in the same shape as the Telegram card (Connected · Verified, "Send a test message", "Disconnect"; "Connect Slack" / "Connect Teams"; "Ask your admin to connect … for your organization" with nothing to click when not installed); and Settings → **Slack and Microsoft Teams** (`apps/web/app/(app)/settings/chat-apps-card.tsx`), a row per platform with "Add to Slack" / "Connect Microsoft Teams", the installed badge, the connected-member count and "Remove". Built from `Card`, `Button` and `Badge` unchanged. Not yet approved by Kumar.
