# ADR 0031: Organization brand kits: drafted from the company website, reviewed by an admin, presentation only (T-123)

**Status:** accepted (Kumar, 2026-11-13)

## Context
- **The ask** (Kumar): a firm should feel it runs its deals on *its* system, with its logo top left after sign-in, its colors, and documents that carry the brand of the side that made them.
- **Kumar's choices:**
  - the kit is fetched from the company website automatically, then reviewed by an admin;
  - each branded organization gets its own sign-in link, `/login/<slug>`;
  - two PRs: the kit, the app and sign-in first; documents and emails second.

## Decision
- **One kit per organization** (`organization_brand_kits`):
  - logo (PNG, JPEG or SVG, at most 512 KB, copied into Pactlab's object store, never hotlinked);
  - accent and primary colors (`#rrggbb`), and a font from the three Pactlab carries (Manrope, Inter, Source Serif);
  - `source`: DEFAULT, EXTRACTED or EDITED;
  - a `draft` holding the last extraction until an admin applies it.
- **Extraction is a draft, never applied on its own.** Saving the website (Settings, or the Home prompt) reads the home page in the background:
  - **logo:** schema.org `Organization.logo` → apple-touch / large icon → `og:image` → a header image named "logo";
  - **accent:** `theme-color` → a `--primary|brand|accent` CSS variable → the PNG logo's palette, greys rejected;
  - **font:** the first `font-family`, mapped to the nearest carried font.
  - **Manual edits win:** re-extraction only replaces the draft. An EDITED kit changes only when an admin applies a draft or edits again.
- **Fetching is SSRF-safe** (`apps/api/src/common/safe-fetch.ts`): https only, no credentials in the URL, every resolved address and every IP-literal host checked against `isBlockedAddress` (private, loopback, link-local, metadata and mapped IPv6) with the connection pinned to the checked address; at most 3 redirects, each re-checked; 5-second timeout; 1 MB HTML, 512 KB CSS and logo.
- **Readable by construction.** The app's theme variables come from `brandThemeVariables` (`packages/domain/src/brand.ts`):
  - fills under navy text (active menu, primary buttons) are lightened until navy reaches 4.5:1;
  - text, links and focus rings are darkened until they reach 4.5:1 on white, and the admin is told when that happened.
- **Who sees it:**
  - members of the organization read the kit (RLS); owners and admins change it (RLS and the service);
  - before sign-in, `app_public_brand(slug)` (SECURITY DEFINER, `pactlab_auth`) returns only the name, colors, font and logo of an **active** organization **with a kit of its own**. Organizations on the Pactlab look have no `/login/<slug>` page, so the page reveals nothing about which workspaces exist beyond what a branded firm chose to publish;
  - guests on another organization's pact see the Pactlab look, not their host's.
- **Logos are inert images.** Every logo response carries `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff`; bytes are type-sniffed on upload and extraction, and only PNG, JPEG and SVG are passed through. The app shows them through `<img>`, never inline.
- **Presentation only.** The kit never feeds findings, valuation, terms or any AI prompt.
- **Not branded:** the marketing site, and sign-in and sign-up codes (they come from Pactlab itself).

## Consequences
- The tab reads "<page> · <Org> · Pactlab" and the sidebar says "on Pactlab" under the firm's logo: the firm's look, with Pactlab still named.
- **Documents (PR 2):** the generating organization's kit is read once at generation and the PDF stored, so a later rebrand never changes an old version; `captured.brand` records what was used (colors, font, logo digest).
  - executive and pact reports and the IC pack: the logo on the cover (PNG or JPEG; an SVG-only kit prints the name as a wordmark), the primary color for headings and table heads where it reads on white, the readable accent for subtitles and rules, the kit's font (Manrope, Inter or Source Serif, all OFL, embedded and subset), the organization as PDF author, and "Powered by Pactlab" on every page;
  - the LOI: the sending (buyer) organization's logo or wordmark, colors and font, "Powered by Pactlab" on every page. Unbranded letters keep the standard fonts, unchanged.
- **Emails (PR 2):** pact invitations sent by a branded organization carry its logo (PNG or JPEG, from its public sign-in route; mail apps do not show SVG) or name, its accent on buttons (darkened until white reads on it), and "Sent with Pactlab for <Org>" above the Pactlab note.
  - **Not branded:** an invitation that names the pact by its codename (a published listing): a logo would name the seller. Listing-interest emails, sign-in and sign-up codes, and operator emails stay Pactlab's.
- **Website at sign-up:** pending sign-ups are held by database functions; rather than change them, an owner or admin of an unbranded organization is asked on Home (skippable, once per browser).
- **Rollback:** revert per organization from Settings. The migration only adds a column and a table; dropping the feature means ignoring them.
