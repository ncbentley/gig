import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TelegramProof = { telegramUserId: string; username: string | null; authDate: number };

const MAX_AGE_SECONDS = 15 * 60;

function hexEqual(given: string, expected: string) {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function fresh(authDate: number, now: number) {
  return Number.isFinite(authDate) && authDate <= now + 30 && now - authDate <= MAX_AGE_SECONDS;
}

export function verifyLoginWidget(fields: Record<string, string>, botToken: string, nowSeconds: number): TelegramProof | null {
  const hash = fields.hash;
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  const pairs = Object.entries(fields)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b));
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
    const key = decodeURIComponent(part.slice(0, eq));
    const value = decodeURIComponent(part.slice(eq + 1));
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "hash") hash = value;
    else pairs.push([key, value]);
  }
  if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const check = pairs.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest("hex");
  if (!hexEqual(hash, expected)) return null;
  const authDate = Number(pairs.find(([key]) => key === "auth_date")?.[1]);
  if (!fresh(authDate, nowSeconds)) return null;
  let user: { id?: number | string; username?: string };
  try {
    user = JSON.parse(pairs.find(([key]) => key === "user")?.[1] ?? "");
  } catch {
    return null;
  }
  const telegramUserId = String(user.id ?? "");
  if (!/^[0-9]{1,20}$/.test(telegramUserId)) return null;
  return { telegramUserId, username: user.username?.trim() || null, authDate };
}
