# Site analytics (Cloudflare Web Analytics) for pactlab.ai

T-085 Part 2, Kumar's pick (2026-11-28). Cloudflare Web Analytics is free,
sets no cookies and collects no personal data. It runs on the **marketing
site only**, never in the app. The site stays on AWS (S3 + CloudFront); only
the beacon script and its token come from Cloudflare.

## How it is wired

- **Build setting:** `NEXT_PUBLIC_CF_BEACON_TOKEN`, a public site token (it ships in every page, so it is not a secret).
  - Read by `apps/site/lib/config.ts`. It must be 16–64 letters and digits, or the build fails.
  - **Unset:** no script at all. Leave it unset for dev, qa and stage.
- **Snippet:** `apps/site/views/shell.tsx` adds the beacon before `</body>`, as Cloudflare documents for a site not proxied through Cloudflare:

  ```html
  <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"…"}'></script>
  ```

  Source: <https://developers.cloudflare.com/web-analytics/faq/> (checked 2026-11-28).
- **Content-Security-Policy:** the site's CSP (`infra/cdk/lib/site-stack.ts`) needs both of these, from the same FAQ:
  - `script-src` must add `https://static.cloudflareinsights.com/beacon.min.js`.
  - `connect-src` must add `https://cloudflareinsights.com`. Manual setups report to `cloudflareinsights.com/cdn-cgi/rum`.
  - Until T-192 ships, the browser blocks the beacon even with the token set.
- **Deploy:** T-192 also passes the token from the `SITE_CF_BEACON_TOKEN` repository variable in `.github/workflows/site.yml`.

## Kumar's checklist (about 10 minutes)

1. [ ] Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>. No domain move or nameserver change is needed.
2. [ ] Dashboard → **Web Analytics** → **Add a site**.
3. [ ] Hostname `pactlab.ai`, select it, then **Done**. Hostnames match by suffix, so `www.pactlab.ai` is covered.
4. [ ] **Manage site** → copy the token: the `"token"` value inside the snippet, not the whole snippet.
5. [ ] GitHub → repository **Settings → Secrets and variables → Actions → Variables** → add `SITE_CF_BEACON_TOKEN` with that value.
6. [ ] After T-192 is merged and the site is published, open <https://pactlab.ai/> and check the dashboard. Visits show within a few minutes.

## Checks

- **View source on any page:** exactly one `static.cloudflareinsights.com/beacon.min.js` script. The app (`app.pactlab.ai`) has none.
- **Browser console:** no CSP violation for `cloudflareinsights.com`. If there is one, T-192's CSP change is not live.
- **An environment's copy (dev/qa/stage):** no beacon.

## Turning it off

Delete the `SITE_CF_BEACON_TOKEN` variable and publish the site. The script disappears, and the CSP entries can stay; they allow the beacon but do not load it.
