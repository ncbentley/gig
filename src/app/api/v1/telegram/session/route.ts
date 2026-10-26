import { eq } from "drizzle-orm";
import { apiError, json } from "@/server/api";
import { createTelegramSession } from "@/server/auth";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { accessForUser } from "@/server/entitlements/service";
import { verifyMiniAppInitData } from "@/server/telegram/link-proof";
import { findActiveLinkByTelegramId } from "@/server/telegram/links";

function initDataFromBody(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  if (!Object.hasOwn(body, "init_data")) return null;
  const initData = (body as { init_data: unknown }).init_data;
  return typeof initData === "string" ? initData : null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const initData = initDataFromBody(body);
  if (initData === null) return apiError(400, "invalid_body", "init_data is required.");

  const botToken = process.env.TELEGRAM_LINK_BOT_TOKEN;
  if (!botToken) return apiError(503, "telegram_unconfigured", "Telegram sign-in is not configured.");

  const proof = verifyMiniAppInitData(initData, botToken, Math.floor(Date.now() / 1000));
  if (!proof) return apiError(401, "invalid_init_data", "Telegram launch proof was rejected.");

  const link = await findActiveLinkByTelegramId(proof.telegramUserId);
  if (!link) return json({ data: { linked: false } });

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, link.userId));
  if (!user) return json({ data: { linked: false } });

  const session = await createTelegramSession(user.id);
  const access = await accessForUser(user);
  return json({
    data: {
      linked: true,
      session_token: session.token,
      expires_at: session.expiresAt.toISOString(),
      user: { id: user.id },
      entitlements: {
        tier: access.tier,
        historyDays: access.historyDays,
        features: [...access.features].sort(),
      },
    },
  });
}
