> Note: this task file collided in numbering with the ready-queue T-018
> (marketing-site expansion, built directly). It is preserved here as
> T-018-multipage.md so both records survive the merge.

# T-018 — Multi-page website: product, industries, flow and feature icons

Status: done
Needs: T-017
Touches: apps/site pnpm-lock.yaml tasks
Lane: brand
Checks: pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @pactlab/site build

## Brief (founder)

Icon next to the logo; tagline "AI rigor. Human judgment." (chosen from
options, descriptor "Diligence for mergers and acquisitions"); multi-page
site; the best of the product on the site with a clear flow and icons for
each feature; a page per target industry describing the value in detail.

## What

- Lockup: flask-and-handshake symbol beside the wordmark (white header;
  white tile on navy footer).
- Pages (20 static): home; product overview + revenue, technology,
  delivery, documents, findings, valuation; industries overview + software
  and SaaS, fintech, healthcare, telecom and media, IT and professional
  services, pharma and biotech, e-commerce and DTC; how it works; trust;
  pilot.
- Decision-loop flow component with icons (horizontal on desktop, vertical
  timeline on mobile; highlights where each module sits).
- Every feature, principle, source and industry item has a line icon
  (lucide-react 1.52.0, pinned; registry enforces valid names by type).
- Industry pages: deal shape, deciding questions, what carries over from
  the core, what the pack adds, sector vocabulary (telecom/media).
  Only Software and SaaS is marked available; the six packs are labelled
  "Planned · pack N" with the spec §19 sequencing note — the site does not
  claim deferred work exists.
- `trailingSlash: true` so every page is `…/index.html` on static hosts.

## Not included

Contact email and app URL (still needed), hosting/DNS, analytics, legal
pages.
