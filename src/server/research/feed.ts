import { asc, gt, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  consolidatedIdeas,
  marketDataSync,
  rawEvents,
  researchFeedLog,
  signalAdjustments,
  signalOutcomes,
  signalTargets,
  signals,
  sources,
} from "@/server/db/schema";
import { assessChronology } from "@/lib/chronology";
import { evidenceLabels } from "@/lib/evidence";
import { describeTargetLadders } from "@/server/ideas/targets";
import { OUTCOME_RULES } from "@/server/outcomes/engine";

export const RESEARCH_FEED_SCHEMA = "research-feed-v1";
export const RESEARCH_FEED_PAGE_MAX = 100;
export const RESEARCH_FEED_WINDOW_MS = 60_000;

export const ENTRY_TRIGGER_RULE = `A market quote more than ${OUTCOME_RULES.maxQuoteDistance} from the bar is not a fill. A fill is the zone edge or the bar open, whichever is better for the trader. A stop and a target touched in the same bar are ambiguous and are not counted as a win.`;

export const RESEARCH_FEED_UNAVAILABLE = [
  "No separate market feed id is stored. instrument is the symbol.",
  "Spread and commission assumptions are not stored.",
  "Gold compositions have no source message, so text and publishedAt stay null. recordedAt and compositionAt are the row insert time, not a publication time.",
  "Silver publishedAt is the newest constituent signal time. recordedAt is when the idea row was stored. Neither is an idea-level outcome time. Silver rows have no signal outcome, so evaluationAt stays null.",
  "A basic fill at least 60 seconds before publication is quarantined. entryTime stays the original bar time. normalizedEntryTime is null, and that row is not executable R evidence. A fill less than 60 seconds early is minute-bar rounding.",
  "spreadCostAssumption null means the cost assumption is unknown, not that cost is zero.",
  "Rows already stored when this log was created appear once, at their then-current revision. Later edits are additional events.",
  "Target hit status is the status at read time.",
  "QA channels are omitted.",
  "The on-screen model board is omitted. Gold means a gold book composition.",
  "Hard-deleted basic calls are not a normal path. Cancellation is a status.",
];

type Entity = "signal" | "idea" | "gold";
type Op = "upsert" | "delete";

interface LogRow {
  seq: number;
  entity: Entity;
  entityId: string;
  op: Op;
  snapshot: Record<string, unknown> | null;
  occurredAt: Date;
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function snap(row: LogRow): Record<string, unknown> {
  return row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
}

function lifecycle(status: string | null): string | null {
  if (status === "PENDING") return "pending";
  if (status === "ACTIVE" || status === "PARTIAL") return "open";
  if (status === "CANCELLED") return "cancelled";
  if (status === "WON" || status === "LOST" || status === "BREAKEVEN" || status === "EXPIRED") return "closed";
  if (status === "INVALID" || status === "MANUAL_REVIEW") return "review";
  return status ? status.toLowerCase() : null;
}

function emptyLineage() {
  return { signalIds: [] as string[], ideaIds: [] as string[], replacedSignalIds: [] as string[] };
}

function base(row: LogRow, tier: "basic" | "silver" | "gold", sourceType: string) {
  return {
    seq: row.seq,
    op: row.op,
    id: row.entityId,
    revision: null as string | null,
    tier,
    sourceType,
    lifecycle: null as string | null,
    status: null as string | null,
    source: null as { id: string; displayName: string; memberName: string } | null,
    lineage: emptyLineage(),
    instrument: null as string | null,
    feed: null,
    direction: null as string | null,
    orderType: null as string | null,
    entry: null as { min: number | null; max: number | null } | null,
    stopLoss: null as number | null,
    targets: [] as { index: number; price: number | null; status: string | null }[],
    horizon: { expiryAt: null as string | null },
    publishedAt: null as string | null,
    editedAt: null as string | null,
    recordedAt: null as string | null,
    deletedAt: null as string | null,
    text: null as string | null,
    outcome: null as Record<string, unknown> | null,
  };
}

function tombstone(row: LogRow, tier: "basic" | "silver" | "gold", sourceType: string) {
  const item = base(row, tier, sourceType);
  item.lifecycle = "cancelled";
  item.deletedAt = iso(row.occurredAt);
  const body = snap(row);
  const ideaId = str(body.idea_id);
  if (row.entity === "signal") item.lineage.signalIds = [row.entityId];
  if (row.entity === "idea") {
    item.lineage.signalIds = strList(body.signal_ids);
    item.lineage.replacedSignalIds = strList(body.replaced_signal_ids);
  }
  if (ideaId) item.lineage.ideaIds = [ideaId];
  return item;
}

interface SignalFacts {
  id: string;
  sourceId: string;
  originEventId: string;
  instrument: string;
  direction: string;
  entryType: string;
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  status: string;
  signalTime: Date;
  expiryTime: Date | null;
  version: number;
}

function factsFromSnapshot(id: string, snapshot: Record<string, unknown>, live: SignalFacts | null): SignalFacts | null {
  if (!snapshot.source_id && !live) return null;
  const sourceId = str(snapshot.source_id) ?? live?.sourceId;
  const originEventId = str(snapshot.origin_event_id) ?? live?.originEventId;
  if (!sourceId || !originEventId) return live;
  return {
    id,
    sourceId,
    originEventId,
    instrument: str(snapshot.instrument) ?? live?.instrument ?? "XAUUSD",
    direction: str(snapshot.direction) ?? live?.direction ?? "LONG",
    entryType: str(snapshot.entry_type) ?? live?.entryType ?? "MARKET",
    entryMin: num(snapshot.entry_min) ?? live?.entryMin ?? 0,
    entryMax: num(snapshot.entry_max) ?? live?.entryMax ?? 0,
    stopLoss: snapshot.stop_loss === undefined ? (live?.stopLoss ?? null) : num(snapshot.stop_loss),
    status: str(snapshot.status) ?? live?.status ?? "PENDING",
    signalTime: live?.signalTime ?? new Date(0),
    expiryTime: snapshot.expiry_time === undefined ? (live?.expiryTime ?? null) : iso(snapshot.expiry_time) ? new Date(String(snapshot.expiry_time)) : null,
    version: num(snapshot.version) ?? live?.version ?? 1,
  };
}

export async function readResearchFeed(cursor: number, limit: number) {
  const db = await getDb();
  const items = [];
  let scanned = cursor;
  let exhausted = false;

  while (items.length < limit && !exhausted) {
    const room = limit - items.length;
    const rows = await db
      .select()
      .from(researchFeedLog)
      .where(gt(researchFeedLog.seq, scanned))
      .orderBy(asc(researchFeedLog.seq))
      .limit(room + 25);
    if (!rows.length) {
      exhausted = true;
      break;
    }
    const mapped = await mapRows(rows as LogRow[]);
    for (let i = 0; i < rows.length; i++) {
      scanned = Number(rows[i].seq);
      if (mapped[i]) items.push(mapped[i]);
      if (items.length === limit) break;
    }
    if (rows.length < room + 25 && items.length < limit) exhausted = true;
  }

  const more = exhausted
    ? []
    : await db.select({ seq: researchFeedLog.seq }).from(researchFeedLog).where(gt(researchFeedLog.seq, scanned)).limit(1);

  return {
    schema: RESEARCH_FEED_SCHEMA,
    generatedAt: new Date().toISOString(),
    page: {
      limit,
      nextCursor: more.length ? String(scanned) : null,
      hasMore: more.length > 0,
    },
    rateLimit: { limit: researchBudget(), windowSeconds: RESEARCH_FEED_WINDOW_MS / 1000 },
    retention: {
      ordering: "seq ascending",
      pageSizeMax: RESEARCH_FEED_PAGE_MAX,
      backfill: "Every basic call, silver idea, and gold composition stored at migration is one event. Changes after that are further events. There is no expiry on this log.",
    },
    unavailable: RESEARCH_FEED_UNAVAILABLE,
    data: items,
  };
}

function researchBudget() {
  const n = Number(process.env.RESEARCH_FEED_RATE_LIMIT ?? 60);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 60;
}

async function mapRows(rows: LogRow[]) {
  const db = await getDb();
  const signalIds = [...new Set(rows.filter((row) => row.entity === "signal").map((row) => row.entityId))];
  const liveSignals = signalIds.length ? await db.select().from(signals).where(inArray(signals.id, signalIds)) : [];
  const signalById = new Map(liveSignals.map((row) => [row.id, row]));

  const sourceIds = new Set<string>();
  const eventIds = new Set<string>();
  const ideaIds = new Set<string>();
  for (const row of rows) {
    const body = snap(row);
    const live = signalById.get(row.entityId);
    if (row.entity === "signal") {
      const sourceId = str(body.source_id) ?? live?.sourceId;
      const eventId = str(body.origin_event_id) ?? live?.originEventId;
      if (sourceId) sourceIds.add(sourceId);
      if (eventId) eventIds.add(eventId);
    }
    if (row.entity === "gold") {
      const ideaId = str(body.idea_id);
      if (ideaId) ideaIds.add(ideaId);
    }
    if (row.entity === "idea") {
      ideaIds.add(row.entityId);
      for (const id of strList(body.signal_ids)) signalIds.push(id);
    }
  }

  const sourceRows = sourceIds.size
    ? await db
        .select({ id: sources.id, name: sources.name, nickname: sources.nickname, isQa: sources.isQa })
        .from(sources)
        .where(inArray(sources.id, [...sourceIds]))
    : [];
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const eventRows = eventIds.size ? await db.select().from(rawEvents).where(inArray(rawEvents.id, [...eventIds])) : [];
  const eventById = new Map(eventRows.map((row) => [row.id, row]));
  const allSignalIds = [...new Set(signalIds)];
  const targetRows = allSignalIds.length
    ? await db.select().from(signalTargets).where(inArray(signalTargets.signalId, allSignalIds)).orderBy(asc(signalTargets.targetIndex))
    : [];
  const outcomeRows = allSignalIds.length
    ? await db
        .select()
        .from(signalOutcomes)
        .where(inArray(signalOutcomes.signalId, allSignalIds))
    : [];
  const editRows = allSignalIds.length
    ? await db.select().from(signalAdjustments).where(inArray(signalAdjustments.signalId, allSignalIds))
    : [];
  const ideaRows = ideaIds.size ? await db.select().from(consolidatedIdeas).where(inArray(consolidatedIdeas.id, [...ideaIds])) : [];
  const ideaById = new Map(ideaRows.map((row) => [row.id, row]));
  const providers = new Map((await db.select().from(marketDataSync)).map((row) => [row.instrument, row.provider]));

  return rows.map((row) => {
    if (row.op === "delete") {
      const tier = row.entity === "signal" ? "basic" : row.entity === "idea" ? "silver" : "gold";
      const sourceType = row.entity === "signal" ? "trader_call" : row.entity === "idea" ? "grouped_idea" : "gig_generated_analysis";
      if (row.entity === "signal") {
        const source = sourceById.get(str(snap(row).source_id) ?? signalById.get(row.entityId)?.sourceId ?? "");
        if (source?.isQa) return null;
      }
      return tombstone(row, tier, sourceType);
    }
    if (row.entity === "signal") return mapSignal(row, signalById, sourceById, eventById, targetRows, outcomeRows, editRows, providers);
    if (row.entity === "idea") return mapIdea(row, targetRows);
    return mapGold(row, ideaById);
  });
}

function mapSignal(
  row: LogRow,
  signalById: Map<string, typeof signals.$inferSelect>,
  sourceById: Map<string, { id: string; name: string; nickname: string; isQa: boolean }>,
  eventById: Map<string, typeof rawEvents.$inferSelect>,
  targetRows: (typeof signalTargets.$inferSelect)[],
  outcomeRows: (typeof signalOutcomes.$inferSelect)[],
  editRows: (typeof signalAdjustments.$inferSelect)[],
  providers: Map<string, string>,
) {
  const liveRow = signalById.get(row.entityId);
  const live: SignalFacts | null = liveRow
    ? {
        id: liveRow.id,
        sourceId: liveRow.sourceId,
        originEventId: liveRow.originEventId,
        instrument: liveRow.instrument,
        direction: liveRow.direction,
        entryType: liveRow.entryType,
        entryMin: liveRow.entryMin,
        entryMax: liveRow.entryMax,
        stopLoss: liveRow.stopLoss,
        status: liveRow.status,
        signalTime: liveRow.signalTime,
        expiryTime: liveRow.expiryTime,
        version: liveRow.version,
      }
    : null;
  const facts = factsFromSnapshot(row.entityId, snap(row), live);
  if (!facts) return tombstone(row, "basic", "trader_call");
  const source = sourceById.get(facts.sourceId);
  if (!source || source.isQa) return null;
  const origin = eventById.get(facts.originEventId);
  const edits = editRows.filter((edit) => edit.signalId === facts.id && edit.type === "EDIT");
  const latestEdit = edits.reduce<Date | null>((latest, edit) => (!latest || edit.effectiveAt > latest ? edit.effectiveAt : latest), null);
  const outcome = outcomeRows.find((item) => item.signalId === facts.id && item.isCurrent) ?? null;
  const item = base(row, "basic", "trader_call");
  item.revision = String(facts.version);
  item.status = facts.status;
  item.lifecycle = lifecycle(facts.status);
  item.source = { id: source.id, displayName: source.name, memberName: source.nickname };
  item.lineage = { signalIds: [facts.id], ideaIds: [], replacedSignalIds: [] };
  item.instrument = facts.instrument;
  item.direction = facts.direction;
  item.orderType = facts.entryType;
  item.entry = { min: facts.entryMin, max: facts.entryMax };
  item.stopLoss = facts.stopLoss;
  item.targets = targetRows
    .filter((target) => target.signalId === facts.id)
    .map((target) => ({ index: target.targetIndex, price: target.price, status: target.status }));
  item.horizon = { expiryAt: iso(facts.expiryTime) };
  item.publishedAt = origin ? iso(origin.publishedAt) : null;
  item.editedAt = facts.version > 1 ? iso(latestEdit) : null;
  item.recordedAt = origin ? iso(origin.receivedAt) : null;
  item.text = origin?.rawText ?? null;
  const publishedMs = origin ? origin.publishedAt.getTime() : facts.signalTime.getTime();
  const chronology = assessChronology(publishedMs, outcome?.entryTime?.getTime() ?? null);
  item.outcome = outcome
    ? {
        methodologyVersion: outcome.calcVersion,
        marketDataSource: providers.get(facts.instrument) ?? null,
        resolution: "1m",
        spreadCostAssumption: null,
        costAssumption: "Cost assumption unknown",
        entryTriggerRule: ENTRY_TRIGGER_RULE,
        sameBarStopTargetAmbiguous: outcome.ambiguous,
        classification: outcome.classification,
        entered: outcome.entered,
        entryTime: iso(outcome.entryTime),
        normalizedEntryTime: chronology.normalizedEntryTimeMs === null ? null : new Date(chronology.normalizedEntryTimeMs).toISOString(),
        chronology: {
          kind: chronology.kind,
          deltaMs: chronology.deltaMs,
          quarantined: chronology.quarantined,
          publicationClock: origin ? "origin_published_at" : "signal_time",
        },
        entryPrice: outcome.entryPrice,
        exitTime: iso(outcome.exitTime),
        exitReason: outcome.exitReason,
        storedRResult: outcome.rResult,
        normalizedRResult: chronology.quarantined ? null : outcome.rResult,
        evidence: evidenceLabels({
          stopSupplied: facts.stopLoss !== null,
          targetsSupplied: item.targets.length > 0,
          rKnown: !chronology.quarantined && outcome.rResult !== null,
          ambiguous: outcome.ambiguous,
          chronologyKind: chronology.kind,
          costKnown: false,
        }),
      }
    : null;
  return item;
}

function mapIdea(row: LogRow, targetRows: (typeof signalTargets.$inferSelect)[]) {
  const body = snap(row);
  const phase = str(body.phase) ?? "available";
  const created = iso(body.created_at);
  const updated = iso(body.updated_at);
  const item = base(row, "silver", "grouped_idea");
  item.revision = String(row.seq);
  item.status = phase;
  item.lifecycle = phase === "history" ? "closed" : phase === "playing-out" ? "open" : "pending";
  const direction = str(body.direction);
  item.direction = direction;
  item.instrument = "XAUUSD";
  item.entry = { min: num(body.entry_min), max: num(body.entry_max) };
  item.stopLoss = num(body.stop_loss);
  const replayPrices = (Array.isArray(body.targets) ? body.targets : []).map((price) => num(price)).filter((price): price is number => price !== null);
  item.targets = replayPrices.map((price, index) => ({ index: index + 1, price, status: null }));
  const signalIds = strList(body.signal_ids);
  const contributed = signalIds.map((signalId) => ({
    signalId,
    prices: targetRows.filter((target) => target.signalId === signalId).map((target) => target.price).filter((price): price is number => price !== null),
  }));
  const ladders = describeTargetLadders({
    direction: direction === "SHORT" ? "SHORT" : "LONG",
    replayTargets: replayPrices,
    contributed,
  });
  item.publishedAt = iso(body.newest_signal_at);
  item.recordedAt = created;
  item.editedAt = created && updated && updated !== created ? updated : null;
  item.lineage = {
    signalIds,
    ideaIds: [],
    replacedSignalIds: strList(body.replaced_signal_ids),
  };
  return {
    ...item,
    constituentPublicationAt: iso(body.newest_signal_at),
    compositionAt: created,
    evaluationAt: null,
    publicationProvenance: "publishedAt and constituentPublicationAt are the newest constituent signal time. recordedAt is when this idea row was stored, not a publication and not an evaluation.",
    targetLadders: ladders,
    evidence: evidenceLabels({
      stopSupplied: item.stopLoss !== null,
      targetsSupplied: replayPrices.length > 0,
      rKnown: false,
      ambiguous: false,
      costKnown: false,
    }),
  };
}

function mapGold(row: LogRow, ideaById: Map<string, typeof consolidatedIdeas.$inferSelect>) {
  const body = snap(row);
  const ideaId = str(body.idea_id);
  const idea = ideaId ? ideaById.get(ideaId) : undefined;
  const retired = body.retired === true;
  const exited = body.exit_time != null;
  const item = base(row, "gold", "gig_generated_analysis");
  item.revision = String(row.seq);
  item.status = retired ? "RETIRED" : exited ? "CLOSED" : "OPEN";
  item.lifecycle = retired || exited ? "closed" : "open";
  item.direction = str(body.direction);
  item.instrument = "XAUUSD";
  item.entry = { min: num(body.entry_min), max: num(body.entry_max) };
  item.stopLoss = num(body.stop_loss);
  item.targets = (Array.isArray(body.targets) ? body.targets : []).map((price, index) => ({
    index: index + 1,
    price: num(price),
    status: null,
  }));
  const compositionAt = iso(body.created_at);
  item.recordedAt = compositionAt;
  item.lineage = {
    signalIds: idea?.signalIds ?? [],
    ideaIds: ideaId ? [ideaId] : [],
    replacedSignalIds: idea?.replacedSignalIds ?? [],
  };
  return {
    ...item,
    compositionAt,
    constituentPublicationAt: idea ? iso(idea.newestSignalAt) : null,
    evaluationAt: null,
    publicationProvenance: ideaId
      ? "This Gold row is linked to a Silver idea. publishedAt stays null: the row has no source message. recordedAt and compositionAt are the Gold row insert time, not that idea's publication."
      : "The model composed this zone. It is not a copy of one Silver idea, and this row stores no Silver idea id. publishedAt stays null. recordedAt and compositionAt are the insert time, not a publication.",
    evidence: evidenceLabels({
      stopSupplied: item.stopLoss !== null,
      targetsSupplied: item.targets.length > 0,
      rKnown: false,
      ambiguous: false,
      costKnown: false,
    }),
  };
}
