# ADR 0039: Feature cards: a registry in code, dismissal per user by version (T-155)

**Status:** accepted (Kumar, 2026-11-24)

## Context
- New capabilities land often and people do not hear about them.
- The ask (Kumar): "what's new" cards on the home; a dismissed card retires to an icon beside the bug icon instead of disappearing.

## Decision
- **Cards are a registry in code** (`apps/api/src/feature-cards/feature-cards.ts`): id, version, ship date, title, one paragraph, optional app link, icon key. Adding a card is one entry. Cards describe shipped features only.
- **Dismissal and reading are stored per user** in `user_feature_cards` (user, card id, dismissed version, read version), never per organization, so it follows the person across devices. RLS: a person reads and writes only their own rows. The table carries no organization or deal identity because it holds no deal data.
- **Versions decide what comes back.** A card is dismissed while `dismissed_version >= version`; bumping `version` puts it back on the home, unread.
- **Arrangement is server-side** (`arrangeFeatureCards`, pure and tested): the home shows at most two undismissed cards, newest first; the rest queue behind the icon. The icon holds the queued and dismissed cards; its badge counts those not yet read. Opening it marks them read.
- **Placement.** The icon is a fixed button immediately left of the bug icon; the bug icon and the shell layout are unchanged. Guests do not see cards.
- **No analytics or tracking.**

## Consequences
- Expand-only migration (`20261230000000_feature_cards`); rollback is dropping the table, after which every card shows as new.
- A removed registry card leaves an orphan row that is ignored.
