# Translation glossary (T-173)

The source of truth for deal vocabulary in the app's German, French and Japanese catalogs (`apps/web/messages/<locale>/`). In diligence a loose synonym for a term of art is a defect, not a style choice: one English term gets one rendering everywhere, and a change here is made in every catalog in the same PR.

Where the marketing site (T-171, `docs/runbooks/site-translations.md`) already renders a term, the app follows it. Where the app's pilot German (T-172) differs from the site, the difference is listed under **Open differences** for the native reviewer to settle once, for both.

## Pactlab terms

| English | German | French | Japanese |
|---|---|---|---|
| Pactlab, Sextant, Foresight, Rinse, Criticals (product and feature names) | not translated | not translated | not translated |
| pact (a deal's shared workspace) | Pact | pacte | パクト |
| deal | Deal | deal | ディール |
| finding | Befund | constat | 所見 |
| draft (finding) | Entwurf | brouillon | ドラフト |
| reviewer | prüfende Person | réviseur | レビュー担当者 |
| evidence | Nachweis | élément de preuve (preuve in tables) | エビデンス |
| source | Quelle | source | ソース |
| scenario | Szenario | scénario | シナリオ |
| claims register / seller statements | Angaben des Verkäufers | affirmations du vendeur | 売り手の主張 |
| verified / contradicted / not checked | bestätigt / widerlegt / nicht geprüft | confirmé / contredit / pas encore vérifié | 検証済み / 矛盾 / 未検証 |
| hand-sourced | von Hand erfasst | saisi à la main | 手入力 |
| withdrawn (import) | zurückgezogen | retiré | 撤回 |
| audit log / audit trail | Prüfprotokoll / Prüfpfad | journal d’audit / piste d’audit | 監査ログ / 監査証跡 |

## Deal terms

| English | German | French | Japanese |
|---|---|---|---|
| drag (a finding that lowers value) | Belastung | frein | ドラッグ |
| cushion (a finding that confirms value; never raises price) | Polster | coussin | クッション |
| neutral | neutral | neutre | 中立 |
| priced risk | bepreistes Risiko | risque chiffré | 価格付きリスク |
| price reduction | Kaufpreisminderung | réduction de prix | 価格減額 |
| escrow | Treuhandeinbehalt | séquestre | エスクロー |
| indemnity | Freistellung | garantie d’indemnisation | 補償 |
| holdback | Einbehalt | retenue de prix | ホールドバック |
| remediation cost | Behebungskosten | coût de remédiation | 是正コスト |
| valuation bridge (purchase-price bridge) | Überleitung (Kaufpreisbrücke) | pont de valorisation | ブリッジ(購入価格ブリッジ) |
| asking price | Angebotspreis | prix demandé | 希望価格 |
| due diligence | Due Diligence | due diligence | デューデリジェンス |
| letter of intent | Absichtserklärung | lettre d’intention | 意向表明書 |
| investment committee | Investitionskomitee | comité d’investissement | 投資委員会 |
| closing / post-close | Closing / nach dem Closing | closing / post-closing | クロージング / クロージング後 |
| quality of earnings | Quality of Earnings | quality of earnings | 利益の質(QoE) |

Escrow, indemnity and holdback are three different instruments: never render one as another, and never use "deposit", "guarantee" or "retention" for them.

## Industry names

The industry names (`common.companyTypes`) follow the site's industry pages. The released pack families and each pack's page names are confirmed against `packages/domain/src/packs/registry.ts` before a locale is enabled; this glossary does not invent a family list.

## Register and form

- German: formal *Sie*. French: *vous*. Japanese: です・ます, no first person.
- Amounts keep the pact's currency code; only separators change (`t.money`).
- A machine-translated string is marked for the next native review, never presented as reviewed.

## Open differences

| Term | App (pilot) | Site | Decision needed |
|---|---|---|---|
| finding (German) | Befund | Feststellung | one word for both |
| pact (German) | Pact | Pakt | keep the English product noun, or translate |
| valuation bridge (German) | Überleitung | Kaufpreisbrücke | one word for both |
| holdback (German) | Einbehalt | not on the site | confirm against practice |
| deal (Japanese) | ディール | ディール | none |
