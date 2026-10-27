# Search consoles (Google and Bing) for pactlab.ai

T-085 Part 2. Both consoles verify domain ownership with a DNS TXT record at
Namecheap, then read `https://pactlab.ai/sitemap.xml`. Bing matters as much
as Google: its index feeds Copilot and ChatGPT search.

Operator task (needs Kumar's Google and Microsoft accounts and Namecheap). About 20 minutes.

## Google Search Console

1. Open <https://search.google.com/search-console> → **Add property** → **Domain** → `pactlab.ai` → **Continue**.
2. Copy the TXT value it shows (`google-site-verification=…`).
3. Namecheap → **Domain List** → pactlab.ai → **Advanced DNS** → **Add new record**:
   - Type **TXT Record**, Host `@`, Value: the string from step 2, TTL Automatic → save.
   - Leave the existing MX and CNAME/ALIAS records alone.
4. Back in Search Console → **Verify**. DNS can take up to an hour; retry if it fails at first.
5. **Sitemaps** → enter `sitemap.xml` → **Submit**. Status should read *Success* with 37 discovered URLs (the count grows as pages are added).
6. **URL inspection** → `https://pactlab.ai/` → **Request indexing**. Repeat for `/industries/` and `/guides/`.

## Bing Webmaster Tools

1. Open <https://www.bing.com/webmasters> and sign in.
2. Easiest path: **Import from Google Search Console** (after Google is verified) — it copies the site and sitemap.
3. Otherwise **Add a site** → `https://pactlab.ai/` → **DNS verification**: add the CNAME or TXT record it shows at Namecheap (same screen as above) → **Verify**.
4. **Sitemaps** → **Submit sitemap** → `https://pactlab.ai/sitemap.xml`.
5. Optional: **IndexNow** is not needed; the sitemap is enough for a site this size.

## Checks after a week

- Google **Pages** report: indexed count close to the sitemap count; no "Excluded by noindex" except the 404 page.
- Bing **Site Explorer**: the same pages present.
- Both: no crawl errors on `/robots.txt`, `/sitemap.xml` or `/llms.txt`.

## When pages change

Nothing to do: the sitemap is generated from the site's routes on every
publish (`apps/site/lib/seo.ts`, checked by `lib/seo.test.ts`). Resubmit only
if a console reports the sitemap as unreadable.
