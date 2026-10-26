import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TelegramProof = { telegramUserId: string; username: string | null; authDate: number };

const MAX_AGE_SECONDS = 15 * 60;

function compareKeys(a: string, b: string) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function hexEqual(given: string, expected: string) {
  const a = Buffer.from(given.toLowerCase(), "utf8");
  const b = Buffer.from(expected.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function fresh(authDate: number, now: number) {
  return Number.isFinite(authDate) && authDate <= now + 30 && now - authDate <= MAX_AGE_SECONDS;
}

function telegramIdFromUserJson(rawUser: string): string | null {
  const quoted = rawUser.match(/"id"\s*:\s*"(\d{1,20})"/);
  if (quoted) return quoted[1];

  const numeric = rawUser.match(/"id"\s*:\s*(\d{1,20})(?!\d)/);
  if (!numeric) return null;

  const digits = numeric[1];
  try {
    const parsed = JSON.parse(rawUser) as { id?: unknown };
    if (parsed === null || typeof parsed !== "object") return null;
    if (typeof parsed.id === "number" && String(parsed.id) !== digits) return null;
    if (typeof parsed.id === "string" && parsed.id !== digits) return null;
  } catch {
    return null;
  }
  return digits;
}

function usernameFromUserJson(rawUser: string): string | null | undefined {
  try {
    const parsed = JSON.parse(rawUser) as { username?: unknown };
    if (parsed === null || typeof parsed !== "object") return undefined;
    if (parsed.username === undefined) return null;
    if (typeof parsed.username !== "string") return undefined;
    return parsed.username.trim() || null;
  } catch {
    return undefined;
  }
}

export function verifyLoginWidget(fields: Record<string, string>, botToken: string, nowSeconds: number): TelegramProof | null {
  const hash = fields.hash;
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  const pairs = Object.entries(fields)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => compareKeys(a, b));
  const check = pairs.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest("hex");
  if (!hexEqual(hash, expected)) return null;
  const authDate = Number(fields.auth_date);
  if (!fresh(authDate, nowSeconds) || !/^[0-9]{1,20}$/.test(fields.id ?? "")) return null;
  const username = fields.username?.trim() || null;
  return { telegramUserId: fields.id, username, authDate };
}

export function verifyMiniAppInitData(initData: string, botToken: string, nowSeconds: number): TelegramProof | null {
  if (!initData.includes("=")) return null;
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  let hash = "";
  for (const part of initData.split("&")) {
    if (!part) return null;
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(part.slice(0, eq));
      value = decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null;
    }
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "hash") hash = value;
    else pairs.push([key, value]);
  }
  if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
  pairs.sort(([a], [b]) => compareKeys(a, b));
  const check = pairs.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest("hex");
  if (!hexEqual(hash, expected)) return null;
  const authDate = Number(pairs.find(([key]) => key === "auth_date")?.[1]);
  if (!fresh(authDate, nowSeconds)) return null;
  const rawUser = pairs.find(([key]) => key === "user")?.[1];
  if (rawUser === undefined) return null;
  const telegramUserId = telegramIdFromUserJson(rawUser);
  if (!telegramUserId || !/^[0-9]{1,20}$/.test(telegramUserId)) return null;
  const username = usernameFromUserJson(rawUser);
  if (username === undefined) return null;
  return { telegramUserId, username, authDate };
}
