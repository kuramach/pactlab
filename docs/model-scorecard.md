# Pactlab Model Scorecard — public benchmarks per routing job

**Date:** November 20, 2026 · **Status:** prior for T-132 routing decisions, refresh monthly
**Scope:** the seven T-132 job types — `deep_review`, `contract_scrub`, `extraction`, `classification`, `document_qa`, `vision`, `fast`

## How to read this

**Public scores are priors, not verdicts.** They rank models for the Admin → AI models evaluation (ADR 0034) to test first and set the default order in the routing registry. They never admit a model to production by themselves: a model serves only after it passes Pactlab's own evaluation on Pactlab documents, inside the $3.50–$10.50 per-deal AI cost target.

**Score, per job** = (1) performance on the public benchmark that actually measures that job, in that benchmark's own metric — scores are **not** comparable across benchmarks or across a benchmark's own cycles when its method changed; (2) **cost per task** — the price of the finished answer, never the per-token list price (verbosity differs more than list price: in one measured run GPT-6 Astra billed 2× Claude Opus 5's token rate and cost ~half per answer, $0.26 vs $0.47 — legal-ai-model-router §8.1, 2026-09); (3) latency/speed where the board publishes it.

**Hard gates — pass/fail, never averaged into any score:**
- Provider data terms recorded in Admin → AI models: DPA in place **and** zero retention true
- US data residency for deal documents
- Pactlab evaluation passed (ADR 0034) on the exact model variant — board names are system names; variants (Max / High / base) score differently and are never merged
- API actually reachable from Pactlab's lanes (several board leaders below carry access caveats)

**Generation note:** the frontier moved since T-132 was designed. GPT-5.6/6.x, Gemini 4 and Claude Fable 5.x are the current boards' models; several models Pactlab currently routes to (marked **▸ current route**) no longer appear on the November boards at all — which is itself a finding, marked per job.

---

## 1. deep_review

**What measures it:** long-form expert review of deal documents. Closest public boards: Harvey **LAB-AA v1.1** (120 private legal tasks, hallucination-gated all-pass, AA-run), **HLAB-Vals-1.1** (agentic legal work with files), **MKA** (end-to-end professional tasks over dense files), and the **AA Intelligence Index** as a general-capability prior. Critical split: the legal boards punish *agentic, multi-file, long-horizon* work; Pactlab's deep_review is single-pass review with documents in context. The two harnesses rank the same models in opposite orders (legalbenchmarks.ai caveat 9).

**Harvey LAB-AA v1.1** — all-pass %, as of Nov 17, 2026 (Artificial Analysis via BenchLeader):

| Model | All-pass | Cost/task | Note |
| --- | --- | --- | --- |
| Astra for Law 6.2 | 20.8% | no public figure | Legal-configured **system** (model + proprietary case-law index), not a bare model; gated access |
| GPT-6.2 Astra | 15.0% | no public figure | Best bare model on this board |
| Muse Wonder Full | 13.1% | no public figure | |
| GPT-6.2 Sol | 11.1% | no public figure | |
| Claude Fable 5.2 | 7.2% | no public figure | |
| **▸ Claude Opus 5.5** | outside top 15 | no public figure | Best non-OpenAI hallucination rate: 0.59 material/task (AA, via OpenAI's report) |

**HLAB-Vals-1.1** — task pass %, as of Nov 18, 2026 (Vals, 120-task holdout):

| Model | Task pass | Cost/test |
| --- | --- | --- |
| Gemini 4 Argon | 27.1% | $10.55 |
| GPT-6.2 Astra | 16.3% | $7.33 |
| Claude Sonnet 5.5 | 10.4% (#28) | $17.71 |
| **▸ Claude Opus 5.5** | 9.2% (#29) | $21.81 |

**Single-pass counterweight** — on legalbenchmarks.ai's single-pass boards (Nov 2026), Opus 5.5 is #1 in both drafting (48.4% task pass, $1.47/task) and extraction (76.7%, §3 below). **MKA** (Google, Nov 10, 2026; multi-file professional deliverables): Fable 5.2 56.6% Climb-WSR / 73.3% overall; Gemini 4 Carbon 54.3% / 71.9%, on ~5.7× fewer tokens. **AA Intelligence Index v5.0.1** (general prior): Fable 5.2 64.6, GPT-6.2 Astra 62.1 (~$4/index task), Gemini 4 Neon 61.4, Opus 5.5 59.1 ($10.04/index task) — as of Nov 9–17, 2026.

**Routing read:** primary **Claude Opus 5.5 ▸ current route** — correct for Pactlab's single-pass harness, where it leads every board. Fallback **GPT-6.2 Astra** (best bare model on the agentic boards). If deep_review ever becomes multi-file agentic work, this read inverts — re-weight to HLAB, where Gemini 4 Argon leads and Claude 5.5 models rank 28–39 at the board's highest costs.

## 2. contract_scrub

**What measures it:** exactly one public study isolates planted-error detection in contracts — **ContractScrub** (Aug 2026). No November board re-measures it on current models; treat successor performance as unmeasured.

| Model | Planted errors caught | Cost/task |
| --- | --- | --- |
| **▸ GPT-5.5** | **75%** | no public figure |
| **▸ Gemini 3.1 Pro** | 74% | no public figure |
| Claude Sonnet 4.6 | 69% | no public figure |
| Claude Opus 4.7 | 62% | no public figure |

Context for the acceptance bar (Spellbook Labs, SEC-filed contracts): ~60% of contracts contain ≥1 drafting issue; purchase/M&A agreements run a ~12–15% high-risk issue rate vs a 3.1% baseline — scrub stakes on deal paper start high, and catching 6 of 7 error classes is materially incomplete, not "86% good."

**Routing read:** primary **GPT-5.5 ▸ current route**, fallback **Gemini 3.1 Pro ▸ current route** — the study supports the current order, by 1 point. This is the one job where the routed models' own generation is the measured generation. Re-run the scrub eval (ADR 0034) on any successor before promoting it; no public score exists for GPT-5.6/6.x or Claude 5.5 on this job.

## 3. extraction

**What measures it:** legalbenchmarks.ai **Data Extraction** (documents in native form, every lawyer-written criterion met in both of two attempts) and **A Few Good Clauses** (26-field contract extraction, May 2026).

**legalbenchmarks.ai, November 2026 cycle** — as of Nov 20, 2026:

| Model | Task pass | Criteria pass | Cost/task | Latency |
| --- | --- | --- | --- | --- |
| **Claude Opus 5.5** | **76.7%** | 91.1% | $2.71 | 3m 03s |
| Claude Fable 5.2 | 66.7% | 89.2% | $5.90 | 3m 07s |
| Claude Fable 5.1 | 63.3% | 89.9% | $1.15 | 3m 51s |
| GPT-6 Astra | 56.7% | 88.4% | $0.93 | 2m 55s |
| Claude Haiku 5.5 | 56.7% | 82.3% | $0.20 | 1m 41s |
| Gemini 4 Argon | 53.3% | 86.2% | $0.27 | ~4m 33s |
| GPT-5.6 Sol | 46.7% | 82.0% | $0.20 | 2m 51s |
| Claude Sonnet 5.5 | 40.0% | 83.3% | $0.92 | 1m 54s |
| **▸ Gemini 3.1 Pro** | not on board | — | — | — |

**July 2026 cycle** (different metric — "reliability"; the source states the cycles are **not comparable**): GPT-5.6 Sol 89.7% (~$0.19/task), Claude Opus 4.8 86.2%, Claude Fable 5 86.2%, **▸ GPT-5.5** 82.8% ($0.15), **▸ Gemini 3.1 Pro** 65.5% ($0.07).

**A Few Good Clauses** (May 2026): **▸ Gemini 3.1 Pro** and Claude Opus 4.6 tied at 82% field accuracy; cost per contract $0.19 (Gemini) vs $1.38 (**▸ GPT-5.5**).

**Routing read:** the current primary's evidence is real but dated — Gemini 3.1 Pro tied for best in May and was cheapest in July, and it has no current-cycle score. On the November board Opus 5.5 leads by 10 points but costs $2.71/task, which breaks the per-deal cost target if extraction runs per document at volume. Suggested shape: **split the job** — schema-bound field extraction is commoditised (a first-party run found strict JSON extraction at 11/11 fields on every frontier model tested), so route it on cost (Haiku 5.5 / Gemini Flash class, Opus fallback on low confidence); open-ended obligations extraction goes to **Opus 5.5** primary, Gemini lane as cost fallback. **▸ Gemini 3.1 Pro** stays the volume lane, not the quality lane.

## 4. classification

**What measures it:** the canonical datasets are **CUAD** (clause identification, 510 contracts) and **MAUD** (M&A deal-point comprehension, 92 question types) — and **no maintained public board scores current frontier models on either**. MAUD's public leaderboard carries only the 2023 paper's fine-tuned encoders (DeBERTa best; Conditions-to-Closing AUPR 48.2%, BigBird 46.6%, BERT 41.7%); CUAD's published results are 2021-era. The nearest current board, Vals **LegalBench** (legal-reasoning MCQ, updated Oct 13, 2026), is saturated — top ten within ~1.6 points: Fable 5 88.56%, **▸ Gemini 3.1 Pro** Preview 87.40%, GPT-5.6 Sol 86.97% at #10 — no routing signal on quality.

| Model | Public classification score (current frontier) |
| --- | --- |
| All current frontier models | **no public figure** on CUAD/MAUD |

**Routing read:** **▸ Gemini 3.1 Pro** stays — not on evidence of superiority, but because classification is structured-output work, and structured output is commoditised at the frontier (see §3). Route this job on cost and latency: a Flash-tier model is the expected end state, with the ADR 0034 eval as the only real arbiter. Do not spend Opus-class money here.

## 5. document_qa

**What measures it:** cited Q&A over a pact's document set. Closest boards: **MKA** (questions and deliverables over multiple visually dense files, incl. contracts) and the document/chart component of **BenchLM's multimodal blend** (§6). No public board isolates cited document Q&A with Pactlab's citation contract.

**MKA** (Google, Nov 10, 2026) — weighted satisfaction rate:

| Model | Climb-WSR (hard criteria) | Overall WSR | Note |
| --- | --- | --- | --- |
| Claude Fable 5.2 | 56.6% | 73.3% | |
| Gemini 4 Carbon | 54.3% | 71.9% | ~5.7× fewer tokens than Fable 5.2 |
| **▸ Gemini 3.1 Pro** | not evaluated | — | — |

Supporting signal: Gemini 4 Argon leads HLAB-Vals-1.1 (§1), the file-work board — the Gemini line is consistently strong on document-heavy work; even the best MKA score leaves the hard criteria under 57%, so citation-checking stays mandatory.

**Routing read:** direction of the current route is right, the generation is stale. **▸ Gemini 3.1 Pro** has no score on any current document board. Evaluate **Gemini 4 Argon** as successor primary (generally available; Carbon's access is limited — verify before routing), fallback **Claude Opus 5.5** for single-pass Q&A over retrieved context.

## 6. vision

**What measures it:** **BenchLM multimodal & grounded** — a blend of image understanding, document/chart reading and visually grounded reasoning. Understanding only; says nothing about image generation. OCR-heavy work should also be tested for resolution and page-count behaviour, which the blend covers only partially.

**BenchLM multimodal & grounded (BenchAlign v6.0)** — as of Nov 19, 2026:

| Model | Score | Note |
| --- | --- | --- |
| Claude Fable 5.2 | 88.0 | #1 of 115 models |
| Gemini 4 Carbon | 86.9 | Access limited — verify before routing |
| **Claude Opus 5.5** | 81.1 | |
| Kimi K3.1 Pro | 70.4 | Best open-weight (#15) |
| **▸ Gemini 3.1 Pro** | **no public figure** on this board | — |

**Routing read:** **▸ Gemini 3.1 Pro** was picked for T-121 on its native document-vision path, and no current public board contradicts the *family* choice — but the routed model itself is unscored on the November boards, and both November leaders sit in other generations. Evaluate **Gemini 4 Argon/Carbon** (family continuity, document strength in §5) and **Claude Fable 5.2** (the board leader) in the vision eval; keep Gemini 3.1 Pro until a successor passes the gate. Nemotron/Qwen VL remain eval challengers, not routing picks.

## 7. fast (triage / first-pass)

**What measures it:** no triage-specific board exists. The usable evidence is the cost/latency columns of the legal boards plus the July cheap tier — for triage, cost per task and latency *are* the score, with a quality floor from §3's task-pass column.

| Model | Quality floor (extraction task pass) | Cost/task | Latency | Source |
| --- | --- | --- | --- | --- |
| **Claude Haiku 5.5** | 56.7% (ties GPT-6 Astra) | $0.20 | **1m 41s — fastest on board** | legalbenchmarks.ai, Nov 2026 |
| GPT-6.1 Sol | 53.3% | $0.13 | 2m 22s | legalbenchmarks.ai, Nov 2026 |
| Gemini 3.5 Flash | 65.5% (July reliability) | ~$0.08 | no public figure | legalbenchmarks.ai, Jul 2026 |
| GPT-5.4-mini | 58.6% (July reliability) | ~$0.01 | no public figure | legalbenchmarks.ai, Jul 2026 |

**Routing read:** current default (Haiku/Flash class) is confirmed and can be sharpened: **Claude Haiku 5.5** primary — it ties flagship models on the extraction floor at $0.20/task with the best measured latency, and beats Sonnet 5.5 on both drafting and extraction boards at a quarter of the price. Fallback: Gemini Flash class. Triage quality above the floor is wasted spend; route on cost and speed only.

---

## Closing: scores vs Pactlab's current routing defaults

| Job | Current default | Verdict from public scores |
| --- | --- | --- |
| deep_review | Claude Opus 5.5 | **Supported.** Leads every single-pass legal board; its poor agentic-board ranks (LAB-AA/HLAB) describe a harness Pactlab doesn't run. No change. Add GPT-6.2 Astra as named fallback. |
| contract_scrub | GPT-5.5 | **Supported** by the only direct study (75% vs Gemini 74%). No change. Successors unmeasured — eval before any promotion. |
| extraction | Gemini 3.1 Pro | **Challenged.** No current-cycle score; Opus 5.5 leads Nov by 10 pts but at $2.71/task vs the per-deal cost ceiling. Split the job: cheap tier for schema fields, Opus 5.5 for open-ended extraction; Gemini stays the volume lane. |
| classification | Gemini 3.1 Pro | **No public evidence either way** — the canonical boards carry no current frontier models. Keep; expect to route down to Flash tier on cost once the ADR 0034 eval confirms parity. |
| document_qa | Gemini 3.1 Pro | **Right family, stale generation.** Gemini 4 tops the document-heavy boards; evaluate Gemini 4 Argon as successor primary, Opus 5.5 fallback. |
| vision | Gemini 3.1 Pro | **Unscored on current boards.** Nov leaders: Fable 5.2 (88), Gemini 4 Carbon (86.9). Evaluate both; no change until one passes the gate. |
| fast | Haiku/Flash class | **Confirmed, sharpen it:** name Haiku 5.5 the primary — flagship-tier quality floor, $0.20/task, fastest measured latency. |

**Three cautions that outrank every table above:**
1. **Boards disagree by harness.** Single-pass boards and agentic boards rank the same models in opposite orders. Weight the board that matches Pactlab's actual harness per job — and re-check if a job's harness changes.
2. **Newest ≠ best is measured, not folklore:** Fable 5.2 trails Fable 5.1 on drafting at 2× cost; Opus 5 beats Opus 5.5 on legal research at under a third of the cost; Haiku 5.5 beats Sonnet 5.5 on drafting and extraction. Promote on the row, never the version number.
3. **Access is part of the score.** Astra for Law is a gated product, Gemini 4 Carbon's access is limited, Muse Spark's API access is unconfirmed — a leader Pactlab cannot call under its data terms is not a routing pick, whatever it scores.

**Sources (all retrieved Nov 20, 2026):** legalbenchmarks.ai Nov 2026 cycle via the legal-ai-model-router canonical scorecard (github.com/sboghossian/legal-ai-model-router, `data/scorecard-2026-11.md`, boards re-pulled 2026-11-20) and its Jul 2026 cycle; ContractScrub (Aug 2026) and A Few Good Clauses (May 2026) per the Nov 17 frontier-models research; Artificial Analysis Intelligence Index v5.0.1 (Nov 9–17, 2026) via BenchLeader/IQ Metrics snapshots; Harvey LAB-AA v1.1 via Artificial Analysis/BenchLeader (Nov 17, 2026) and Harvey's own holdout baselines (May 26, 2026); HLAB-Vals-1.1 and Vals Legal Research Bench (Nov 18, 2026); BenchLM multimodal & grounded (Nov 19, 2026, benchlm.ai); MKA (Google, Nov 10, 2026); MAUD/CUAD/LegalBench via the Atticus Project and Vals (Oct 13, 2026); Spellbook Labs contract error study (2026).
