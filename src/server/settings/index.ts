import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret, secretKeySource, type SecretKeySource } from "@/server/crypto/secret";
import { getDb } from "@/server/db";
import { appSettings } from "@/server/db/schema";

export type { SecretKeySource };
export { secretKeySource };

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (!row) return null;
  try {
    return JSON.parse(decryptSecret(row.valueEncrypted)) as T;
  } catch (err) {
    console.error(`[settings] could not read ${key}:`, (err as Error).message);
    return null;
  }
}

export async function setSetting(key: string, value: unknown) {
  const db = await getDb();
  const valueEncrypted = encryptSecret(JSON.stringify(value));
  await db.insert(appSettings).values({ key, valueEncrypted }).onConflictDoUpdate({ target: appSettings.key, set: { valueEncrypted } });
}

export async function deleteSetting(key: string) {
  const db = await getDb();
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

export const SETTING_KEYS = {
  telegramApi: "telegram.api",
  telegramSession: "telegram.session",
  marketData: "market_data",
} as const;
