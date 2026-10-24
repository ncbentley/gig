# GIG quality audit — 2026-10-24

Owner audit: findings and an improvement plan. No production fix was deployed with that audit. This file is the tracked record for branch `cursor/gig-quality-audit-repairs-9b80`.

A code change is not proof a defect is fixed. Status is what this branch does, what was retested here, and what remains. Original timestamps and outcome rows are not rewritten. Missing R is not stored as zero. A win label is not treated as audited monetary R. Null spread cost is labeled unknown.

Retest evidence in this environment is unit tests and typecheck, plus public-page checks that do not call collectors, model APIs, or payment providers. Live-site and production-cache reconciliation was not run.

## Status

| ID | Status | Note |
| --- | --- | --- |
| GIG-001 | Partially addressed | Read-time quarantine and year-visible UTC labels. Stored `entryTime` kept. Outcome rows not recomputed. Live feed not reconciled. |
| GIG-002 | Partially addressed | Expectancy rank requires 20 known-R trades. Tables show closed n and known-R n. Dashboard snapshot can lag until its existing rebuild. |
| GIG-003 | Partially addressed | Research feed adds composition, publication, and evaluation fields where the pipeline already has them. Gold `publishedAt` and Silver `evaluationAt` stay null, with provenance text. |
| GIG-004 | Partially addressed | Stable labels on the signal page, source stats, and research-feed evidence. No public methodology page exists, so labels are not linked. |
| GIG-005 | Partially addressed | Prompt guardrails, mock analyst, and on-page caveat. Stored historical AI rows are not rewritten. No model API was called. |
| GIG-006 | Fixed in this PR | `/sources` labels the expectancy cap as top 50 and searches every tracked source. Known-R filter paginates. |
| GIG-007 | Partially addressed | Apply dates, chips, reversed-range error, and a pending banner. Not clicked in a signed-in browser here. |
| GIG-008 | Fixed in this PR | Homepage, pricing, terms, dashboard, and Gold detail use the same origin rule as the board prompt. No profit promise. |
| GIG-009 | Fixed in this PR | Pass CTAs state that the $10 pass creates no code and earns no commission, plus the lower-tier rule and the $25 withdrawal floor. |
| GIG-010 | Open | Terms and privacy still need owner review of actual business practices. The MVP counsel warning was left in place. No finalized replacement copy was found in the repo. |
| GIG-011 | Partially addressed | Absolute UTC includes the year. Dashboard spot shows the stored bar time and the existing Sunday 22:00–Friday 21:00 UTC session rule. |
| GIG-012 | Partially addressed | Stored replay ladder is not reordered. Research feed exposes contributed targets beside it. The idea page states the mean-per-slot rule and when the ladder is non-monotonic. |
| GIG-013 | Fixed in this PR | One duration formatter rounds total minutes before splitting hours. Boundary tests cover 0, 59m, 60m, 61m, 119m, and 120m. |
| GIG-014 | Partially addressed | Homepage, signals, and sources name closed trades, stored calls, and known-R separately, with an as-of time. Counts are not forced to match. |

## GIG-001 Chronology

Expected: an entry at least 60 seconds before publication is quarantined; a fill less than 60 seconds early is minute-bar rounding; originals stay; the UI shows the year.

Actual in this branch: `assessChronology` classifies `aligned`, `minute_bar_rounding`, and `quarantined`. Stats version `stats-v2` drops quarantined entered rows from closed, win, and R aggregates and counts them in `chronologyQuarantined`. The signal page keeps the stored fill time, omits that fill from the chart, and prints both clocks when the origin `publishedAt` and `signalTime` differ by a second or more. Publication identity is `raw_events.publishedAt` (Telegram `date` seconds via `new Date(seconds * 1000)`; the year is not stripped). `signals.signalTime` is the ingest copy. Replay still starts at `ceil(signalTime / 60s)`. The engine test locks the audit example class: a 2025-10-08 bar does not fill a 2026-10-23 call.

Scope: read path and new aggregates on the next local stats read. `signal_outcomes` rows are not updated. No backfill job was enqueued.

Not run: recount of the 1612/29303 cached Basic rows, and no fetch of the two production signal URLs.

## GIG-002 Denominator mismatch

Expected: every metric shows its denominator; expectancy rank uses known R, not closed trades; one known R cannot rank a 35-win source.

Actual: `expectancyEligible` requires `ratedTrades >= 20` and a non-null expectancy. Win rate still uses closed trades, including no-stop closes. `unknownR` is closed minus rated. Coverage is rated/closed. The source table and the source profile both say so. The compute fixture is 35 wins with one `rResult` of 0.96: unranked, expectancy 0.96 on n=1, unknown R 34.

`?? 0` appears only as the average of an empty win or loss class whose count is already zero. Missing R is not inserted as 0.

Not run: the production source `f89d44af-1d77-454d-8eea-0f71ce097852`. The member dashboard ranking is a stored snapshot and keeps the previous order until the existing snapshot job runs.

## GIG-003 Gold and Silver provenance

Expected: composition, publication, and evaluation timestamps, or a documented gap. `recordedAt` is not publication time.

Actual on the research feed: Basic `publishedAt` is the origin event time; `recordedAt` is receipt time. Silver `publishedAt` and `constituentPublicationAt` are the newest constituent signal time; `recordedAt` and `compositionAt` are the idea row time; `evaluationAt` is null because Silver has no signal outcome. Gold `publishedAt` stays null (no source message); `compositionAt` and `recordedAt` are the gold row insert time; `constituentPublicationAt` is the linked Silver idea's newest signal time when `ideaId` is set, otherwise null. Provenance strings are on the feed items. The Gold page labels "Gold row stored" with the row time.

Not run: the live research feed. No new Silver or Gold outcome contract.

## GIG-004 Missing data

Labels, exact strings: No stop supplied, No targets supplied, R unavailable, Cost assumption unknown, Ambiguous minute, Entry before publication, Minute-bar rounding.

They appear on the unlocked signal page and on Basic research-feed evidence. Rankings and the commentary helper treat a missing stop, missing targets, or a quarantined fill as insufficient for an expectancy claim. There is no public methodology page; `DECISIONS.md` is not linked from the product.

Not done: a label on every admin surface and every list card. Sampled production null counts were not remeasured.

## GIG-005 Commentary

The mock signal summary leads with the insufficient-evidence sentence and does not say the trade "closed as won" or "strong" / "high average" for the sparse fixture (35 closed, 1 known R, no stop, no targets, quarantined fill). Source-pattern copy uses the same threshold. Prompt guardrails tell a live model the same constraints. The numeric confidence field remains because the stored schema requires a 0–1 number; the page calls it an uncalibrated label weight, not a win probability. Results after the call are not used as a reason for the call.

Stored AI rows already in the database are unchanged. No model was called.

## GIG-006 Source directory

`/sources` renders at most 50 expectancy-eligible sources and says that is a cap. Search (`q`) and `eligible=known-r` read every tracked source, 25 per page. Members search the nickname only. Admins search the channel name, because that is the name they are shown. Sort inside the table still reorders the rows on the page.

## GIG-007 Signal date filters

Reproduction before the change: the date inputs were uncontrolled `defaultValue` plus `onChange`, unlike direction and `q`, which already wrote the URL. The server also applied a reversed range, which can return an empty list.

This branch uses controlled date inputs, an Apply dates action, drops `page` on that write, shows chips, and refuses a reversed or invalid range in `parseSignalFilters` and `GET /api/v1/signals` (`rangeError`). While navigation is pending, the list is labeled as the previous results.

Not clicked while signed in. An immediate loading snapshot can still be mistaken for a finished result if the banner is not read; the banner is the mitigation.

## GIG-008 Public copy

Code rule, from the Gold board prompt: Gold is a smaller set chosen from Silver ideas. The model may keep a Silver idea or compose a zone. A composed zone does not copy one Silver idea, takes a slot, and leaves `ideaIds` empty when it is not tied to one idea.

Homepage plan lines, the Gold section, pricing, the plan-picker tagline, the dashboard book line, the Gold detail empty state, and the terms "what the service is" sentence now say that. Terms no longer say the service does not create signals. The rest of the terms, and the MVP warning, are unchanged. The terms "updated" date is 24 October 2026 because that sentence changed.

## GIG-009 Referrals

Existing rules, now beside the pass CTA on the homepage, pricing, and billing, and on the referrals page: a code is created with the first monthly payment; the $10 pass does not create a code and earns no commission; the fee is the lower of the two monthly tiers and only when the collected amount equals the catalog monthly price; manual withdrawals start at $25. Amounts come from `PASS_PRICE_CENTS`, `REFERRAL_FEE_CENTS`, and `MIN_WITHDRAWAL_CENTS`.

## GIG-010 Terms and privacy

Open. No finalized privacy or terms copy was found unwired in the repo. The counsel warning on the legal page remains.

## GIG-011 Timestamps

`fmtDateTime` is `DD Mon YYYY, HH:mm UTC` (example: `23 Oct 2026, 02:30 UTC`). The signals nav and title no longer say "Live". The dashboard price is "stored bar" plus age plus the existing `isGoldMarketOpen` window. Session state is that window, not a new market-closed detector. Relative age remains next to the absolute time so a 2-minute-old bar is not read as the narrative clock.

## GIG-012 Targets

`describeTargetLadders` keeps the stored order. The fixture `3997.67, 3990, 3996, 3993, 3990` is non-monotonic and is not sorted. Grouping remains the mean of each slot among sources that supplied that slot, equal weight, which is what `group.ts` already does. The idea page says so and lists each source's own targets below. The research feed adds `targetLadders.contributed` from `signal_targets`.

Not run: the production idea hash.

## GIG-013 Duration

`fmtMinutes` rounds the absolute minute count first, then splits. `419.6` minutes is `7h`, not `6h 60m`. `fmtAge` uses the same function.

## GIG-014 Counts

Homepage hero is the sum of per-source closed trades after chronology quarantine, labeled closed trades, with as-of time. `/signals` is stored calls matching filters, including open rows. `/sources` repeats the closed-trade sum and the eligible/tracked counts. Dashboard "tracked sources" is the ranking snapshot. Research-feed Basic rows are log rows. These are not forced equal.

## Deliberately unchanged

- Production data, collectors, model APIs, payments, and credentials.
- Historical `signal_outcomes` rows, including original `entryTime` and `rResult`.
- Dashboard snapshot rebuild. It was not triggered.
- Design proposals D01–D08 and the member workspace layout.
- GIG-010 legal boilerplate beyond the one product-origin sentence.
- Silver and Gold outcome calculation. There is still no outcome row to attach.

## Reviewer risks

- The first `/sources` or homepage ranking read after `stats-v2` recomputes each stale `source_stats` row from local signals and outcomes. That writes the stats cache. It does not call an external API and does not update outcome rows. It can be slow.
- Member dashboard order stays on the previous snapshot until the existing snapshot job runs. The table footer already describes the known-R rule; the row order may not match it until then.
- Quarantine changes expectancy and closed counts on the next stats read. That is the intended correction. It will not match numbers captured on 2026-10-24.
- Search on `/sources` loads stats for every tracked source.
- Confidence remains a number in stored AI JSON. The UI label is what changed.
