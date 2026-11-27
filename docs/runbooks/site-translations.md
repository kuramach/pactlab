# Site translations (German, French, Japanese)

How the marketing site's languages are written, reviewed and published (T-171, ADR 0057).

## Where things are

| What | Where |
|---|---|
| Languages, review flags, country map, entry paths | `apps/site/lib/i18n/locales.ts` |
| English interface words (source) | `apps/site/messages/en/ui.ts` |
| English page copy (source) | `apps/site/lib/content.ts`, `industry-stories.ts`, `answers.ts`, `cases.ts` |
| Translations | `apps/site/messages/{de,fr,ja}/` — `ui`, `content`, `industries`, `stories`, `faqs`, `guides`, `comparisons`, `cases` |
| Completeness test | `apps/site/lib/i18n/catalog.test.ts` |
| Edge routing | `infra/cdk/functions/site-viewer-request.js`, config from the build's `/locales.json` |
| Layout proof | `docs/screenshots/t-171/` |

## Changing English copy

Every English string on a translated page has a translation. Changing or adding one fails `pnpm typecheck` (interface words) or `pnpm test` / `next build` (page copy) until each of `de`, `fr` and `ja` has the new words. Write the translation in the same PR; if it is machine-made, mark the change for that language's next native review.

## Preview a language before it is published

```bash
NEXT_PUBLIC_LOCALE_PREVIEW=true pnpm --filter @pactlab/site build
node apps/site/e2e/edge-server.ts 3110   # serves out/ through the CloudFront Function
# http://localhost:3110/de/  — or curl -H 'CloudFront-Viewer-Country: JP' -i http://localhost:3110/
```

## Native review checklist (one per language)

A native speaker with deal experience completes this for the language; the PR that ticks the last box sets `NATIVE_REVIEW.<locale>.complete = true`. Until then the language is built but unlinked, `noindex` and never routed to.

- [ ] Tagline approved by Kumar (renderings below).
- [ ] Home, how it works, about, story and vision read naturally; no literal calques.
- [ ] Industry pages: all 17 — headline, deal shape, questions, walkthrough, example findings, deliverables, FAQ.
- [ ] Guides, questions and answers, the comparison and the case-studies index.
- [ ] Deal vocabulary consistent and as practitioners use it (see the glossary below); register consistent (Sie / vous / です・ます).
- [ ] No claim stronger than the English: "available", "pilot", "never", "only" kept as strong as, and no stronger than, the source; no invented figures or customers.
- [ ] Regulatory names left as the source states them (Rule 506(b)/(c), §203/§304, HIPAA, Form D, Medicare) and not localized into a different regime.
- [ ] Links marked as English-only where they lead to an English page.
- [ ] Layout checked at 390 px and 1,280 px on home and two industry pages (screenshots in the PR): no clipped or overflowing text, sensible line breaks (Japanese phrases, German compounds).
- [ ] Interface words: header, footer, switcher, buttons, carousel controls and their screen-reader labels.

### Tagline renderings (for Kumar's approval)

| Language | Tagline | Literal back-translation |
|---|---|---|
| English | AI rigor. Human judgment. | — |
| German | KI-Gründlichkeit. Menschliches Urteil. | AI thoroughness. Human judgment. |
| French | La rigueur de l’IA. Le jugement humain. | The rigor of AI. Human judgment. |
| Japanese | AIの厳密さ。人の判断。 | The rigor of AI. The judgment of people. |

Used everywhere the tagline appears: the header lockup, the footer, the first slide's eyebrow, page titles and the organization JSON-LD.

### Glossary used by the machine translation

| English | German | French | Japanese |
|---|---|---|---|
| finding | Feststellung | constat | 所見 |
| reviewer | prüfende Person | réviseur | レビュー担当者 |
| deal terms | Deal-Konditionen | conditions du deal | ディール条件 |
| purchase-price bridge | Kaufpreisbrücke | pont de prix d’acquisition | 購入価格ブリッジ |
| escrow / indemnity | Treuhandeinbehalt / Freistellung | séquestre / garantie d’indemnisation | エスクロー / 補償 |
| claims register | Aussagenregister | registre des affirmations | 主張の登録簿 |
| verified / contradicted / unverified | bestätigt / widerlegt / unbestätigt | vérifié / contredit / non vérifié | 検証済み / 矛盾 / 未検証 |
| pact | Pakt | pacte | パクト |
| closing condition | Closing-Bedingung | condition suspensive | クロージング条件 |

## Publish a language

1. Native review complete (checklist above, in the PR description).
2. Set `NATIVE_REVIEW.<locale>.complete = true` in `apps/site/lib/i18n/locales.ts`.
3. `pnpm --filter @pactlab/site test` and `pnpm --filter @pactlab/site test:e2e` green.
4. Merge and publish the site (docs/runbooks/website.md). The build writes `/locales.json` with the language in `published`; the stack picks it up at synth, so the switcher, hreflang, sitemap and country routing switch on together.
5. Check: `https://pactlab.ai/locales.json` lists the language in `published`; the sitemap lists `/de/…` with alternates; and a first visit from the market (or a VPN exit there, in a private window) lands on the language. The country is the one CloudFront derives from the connection, so stubbing the header works only against the local e2e server.

## Unpublish a language

Set its flag back to `false`, merge and publish. Its pages stay built but return to `noindex`, the switcher drops it and the edge stops routing to it on the next deploy. Visitors whose cookie names it are no longer redirected (an unpublished cookie value is ignored).
