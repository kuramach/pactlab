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

The live examples are on `/design-system`.
