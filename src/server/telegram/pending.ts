import { createHmac, timingSafeEqual } from "node:crypto";

export type PendingTelegram = {
  id: string;
  username: string | null;
  authDate: number;
  exp: number;
};

function macMatches(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signBody(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function signPendingTelegram(payload: PendingTelegram, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${signBody(body, secret)}.${body}`;
}

function pendingFromJson(value: unknown, nowMs: number): PendingTelegram | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { id, username, authDate, exp } = record;
  if (typeof id !== "string" || !/^[0-9]{1,20}$/.test(id)) return null;
  if (username !== null && typeof username !== "string") return null;
  if (typeof authDate !== "number" || !Number.isFinite(authDate)) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || !(exp > nowMs)) return null;
  return { id, username, authDate, exp };
}

export function readPendingTelegram(cookie: string, secret: string, nowMs: number): PendingTelegram | null {
  const dot = cookie.indexOf(".");
  if (dot <= 0) return null;
  const mac = cookie.slice(0, dot);
  const body = cookie.slice(dot + 1);
  if (!body || !macMatches(mac, signBody(body, secret))) return null;
  try {
    return pendingFromJson(JSON.parse(Buffer.from(body, "base64url").toString("utf8")), nowMs);
  } catch {
    return null;
  }
}
