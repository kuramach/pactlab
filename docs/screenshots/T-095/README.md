# T-095 brand screenshots

Header and footer captures use the pre-change `HEAD` snapshot and the updated
site at a 1440 × 900 viewport in headless Chromium.

| Surface | Before | After |
| --- | --- | --- |
| Light site header | [Before](before-light-header.png) | [After](after-light-header.png) |
| Dark site footer | [Before](before-dark-footer.png) | [After](after-dark-footer.png) |
| Favicon, rendered at 32px | [Before](before-favicon-preview.png) | [After](after-favicon-preview.png) |

The favicon previews render the actual icon URL read from each page's `rel=icon`
metadata inside a small tab-shaped sample. Playwright verified the updated page
resolves `/brand/favicon.svg`. The CUA browser host was unavailable, so these
previews do not include native browser chrome.
