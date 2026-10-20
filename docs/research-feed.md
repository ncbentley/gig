# GIG research feed — Aetherion brief

You already hold the only read bearer. Do not ask for another, do not print it, and do not send it to any other system. Send it only as `Authorization: Bearer <token>` to the URL below.

This feed is evidence for research. It cannot place an order, size a position, or turn the GIG bot on. The bot stays off.

## Endpoint

```
GET https://goldintelligencegateway.com/api/v1/research/feed
```

Schema: `research-feed-v1`.

| Query | Meaning |
| --- | --- |
| `limit` | Page size. Integer 1–100. Default 50. Use 100. |
| `cursor` | Decimal `seq` already applied. Omit it to start at the beginning. |

Events are ordered by `seq` ascending. `page.nextCursor` is the cursor for the next page. It is null on the last page. The same cursor returns the same page. Sequence numbers can skip. A skip is an omitted QA channel, not a missing event.

`generatedAt` is when this response was built. Never store it as a publication time.

## Responses that stop the loop

| HTTP | Code | What to do |
| --- | --- | --- |
| 200 | | Apply `data`, then advance. |
| 400 | `invalid_cursor` or `invalid_limit` | Fix the query. Do not advance. |
| 401 | `invalid_token` | Stop. The bearer was replaced. Do not guess. |
| 429 | `rate_limited` | Sleep for the `Retry-After` header, then repeat the same cursor. |
| 503 | `research_feed_disabled` | The server has no token configured yet. Back off for several minutes. |
| 403 | | Cloudflare blocked the request before the app. This is not an auth failure. Back off. Do not hammer it. |

Budget: 60 requests per minute for this bearer. Headers `x-ratelimit-limit` and `x-ratelimit-remaining` are on each allowed response.

## Full history, once

Do this before any live poll.

1. Store nothing yet. Cursor is empty.
2. `GET` with `limit=100` and no cursor.
3. Apply every event in `data` in order.
4. If `page.nextCursor` is set, request again with that cursor. If it is null, history is caught up.
5. Persist the last applied `seq` as the cursor. Persist `schema`.

On `429`, sleep and repeat the same cursor. Applying a `seq` you already applied is a no-op.

Until `nextCursor` is null, the dataset is incomplete. Do not compute breadth, vote share, or a research note from a partial backfill.

## Real time, after that

Every 30 seconds:

1. `GET` with the saved cursor and `limit=100`.
2. Apply new events. Save the highest applied `seq`.
3. If `page.hasMore` is true, keep requesting immediately until `nextCursor` is null, still honoring `429`.
4. If the page is empty and `nextCursor` is null, nothing new arrived. Leave the cursor where it is.

A quiet poll still costs one request. Thirty seconds is about two requests a minute, which leaves room to drain a burst.

## How to apply one event

Dedupe on `seq`. The durable identity of a thing is `id` inside its tier.

| `tier` | `sourceType` | What `id` is |
| --- | --- | --- |
| `basic` | `trader_call` | One trader call. |
| `silver` | `grouped_idea` | One grouped idea. |
| `gold` | `gig_generated_analysis` | One gold-book composition. |

`op: "upsert"` means this `seq` is a newer picture of that id. Keep the previous picture if you want history, and make this one current when its `seq` is the greatest you have seen for that id.

`op: "delete"` means that silver idea or gold composition was removed. `deletedAt` is when the removal was logged. Basic calls are not removed this way. A cancelled call stays an upsert with `status: "CANCELLED"` and `lifecycle: "cancelled"`.

## What to store for a basic call

Use these fields and leave nulls null.

- `source.id` is the stable trader id. `source.displayName` is the channel title. `source.memberName` is the nickname members see. Provenance uses the channel title.
- `instrument` is the symbol, normally `XAUUSD`. `feed` is null. There is no separate feed id.
- `direction` is `LONG` or `SHORT`.
- `orderType` is `MARKET`, `LIMIT`, or `ZONE`.
- `entry.min` and `entry.max` are the entry or the entry range. A single price has both bounds equal.
- `stopLoss` and `targets` are the stop and the ordered targets. `targets[].index` starts at 1.
- `horizon.expiryAt` is the stated expiry. Null means the call did not state one.
- `text` is the original permitted message.
- `publishedAt` is when the source message was published. `recordedAt` is when GIG received it. `editedAt` is set only when `revision` is greater than 1.
- `revision` is the call's integer version.
- `status` is the canonical state: `PENDING`, `ACTIVE`, `PARTIAL`, `WON`, `LOST`, `BREAKEVEN`, `CANCELLED`, `EXPIRED`, `INVALID`, `MANUAL_REVIEW`.
- `lifecycle` folds that into `pending`, `open`, `closed`, `cancelled`, or `review`. `ACTIVE` and `PARTIAL` are open. `WON`, `LOST`, `BREAKEVEN`, and `EXPIRED` are closed.

## Silver and gold are layers, not extra votes

A vote is one basic call from one `source.id`.

- A silver row's `lineage.signalIds` are the basic calls inside the group. `lineage.replacedSignalIds` are calls the group dropped. Do not count the silver row as another vote.
- A gold row's `lineage.ideaIds` are the silver ideas it was composed from, and `lineage.signalIds` are those ideas' basic calls. Do not count the gold row as another vote.
- Attach silver and gold as context on the basic calls they name. If a named id is not in your store yet, keep the link and mark the target missing. Do not invent the call.

Silver `publishedAt` is the newest constituent call time. Gold has no source message, so gold `text` and `publishedAt` stay null. Gold `recordedAt` is when GIG stored the composition.

Silver `status` is `available`, `playing-out`, or `history`. Those map to lifecycle `pending`, `open`, and `closed`. Gold `status` is `OPEN`, `CLOSED`, or `RETIRED`.

## Outcomes

`outcome` is present only on a basic call GIG has replayed. It is GIG's replay, not your 15/60/240 study.

- `methodologyVersion` is the rule set. Current rules are `outcome-v6`.
- `marketDataSource` is the bar provider. `resolution` is `1m`.
- `entryTriggerRule` describes the fill. A market quote more than 80 away from the bar is not a fill. A fill is the zone edge or the bar open, whichever is better for the trader.
- `sameBarStopTargetAmbiguous` true means the stop and a target printed in the same minute. That bar is not a win.
- `spreadCostAssumption` is null. No spread or commission is stored. Do not assume one.
- `classification`, `entered`, `entryTime`, `entryPrice`, `exitTime`, and `exitReason` are the replay result.

Site win rates are not in this feed. Do not treat a directional vote share, or GIG's classification, as a calibrated win probability.

`targets[].status` and `outcome` are the values at the time you fetched them. On an older `seq` they can already show the later result. For "what was true at this seq", trust `status`, `revision`, `entry`, and `stopLoss` on that event. For "what is true now", trust the event with the greatest `seq` for that id.

Calls already in the database when this log was created appear once, at the revision they had then. Earlier drafts of those calls are not replayed. Edits after the log start are later events.

## Breadth, without a model

After a complete backfill, and again when new basic calls arrive, run this with rules only:

1. Take each basic call. Ignore silver and gold for the measurement.
2. From `publishedAt`, look at the instrument 15, 60, and 240 minutes later using your own market data.
3. Record the price path and whether the call's stop or targets were touched in each window.
4. Keep GIG's `outcome` beside that result. Do not overwrite either with the other.
5. If `publishedAt` is null, skip the call and say so. Do not use `recordedAt` or `generatedAt` in its place.

## What a research note may say

A note may describe agreement across basic calls, the silver groups those calls belong to, and the gold compositions that selected them. It must list missing fields as missing. It must not recommend an order, a size, or turning the bot on.

The on-screen model board is not in this feed. QA channels are not in this feed. Member, account, and payment data are not in this feed.
