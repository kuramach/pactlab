# Section accents (T-153)

Long card pages (Settings, Admin) give each section its own muted accent so the eye can tell where one section ends. Colour is orientation only: section titles stay, and no meaning depends on colour.

Use it: `<Card section="billing">` (key from the registry) or `<Card accent="moss">`. The card gets a 4px left rule in the accent and a faint accent tint on its header; the body stays on the standard surface.

## Accents (`src/section-accents.ts`)

| Key | Hex |
|---|---|
| indigo | #4a58e8 |
| cobalt | #2f5fb8 |
| teal | #0f766e |
| violet | #6d4fc2 |
| slate | #475569 |
| plum | #8a4a8f |
| moss | #4d7c3a |
| bronze | #9a5b13 |

All are at least 4.5:1 on white. Header tints mix the accent into the card surface at 9%, so text keeps AA in light and dark themes.

## Assignments

`SECTION_REGISTRY` maps every section key to an accent, in one place. A section keeps its colour wherever it appears.

## Rule for new sections

Pick the next unused accent in the registry order — do not reuse a neighbour's. If all eight are in use on a page, repeat only non-adjacent ones.
