import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { deliverEmail, usesResend } from "@/server/auth/email";
import { getDb } from "@/server/db";
import { authTokens, outboundEmails, sessions, users, type User } from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/lib/hash";

export const SESSION_COOKIE = "gsi_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function appUrl() {
  return process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 4317}`;
}

export async function createSession(userId: string) {
  const db = await getDb();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt, source: "web" });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function createTelegramSession(userId: string) {
  const db = await getDb();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt, source: "telegram" });
  return { token, expiresAt };
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export type SessionSource = "web" | "telegram";

/** Active session for a raw token. Callers that care about website vs Mini App read `source`. */
export async function findActiveSession(
  token: string | undefined | null,
): Promise<{ user: User; source: SessionSource } | null> {
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ user: users, source: sessions.source })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function userFromSessionToken(token: string | undefined | null): Promise<User | null> {
  const session = await findActiveSession(token);
  return session?.user ?? null;
}

/** Website cookie auth. A Mini App bearer is not a website login. */
export async function userFromWebSessionToken(token: string | undefined | null): Promise<User | null> {
  const session = await findActiveSession(token);
  if (session?.source !== "web") return null;
  return session.user;
}

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  return userFromWebSessionToken(jar.get(SESSION_COOKIE)?.value);
});

export async function sendEmail(to: string, subject: string, body: string) {
  if (usesResend()) {
    await deliverEmail(to, subject, body);
    console.info(`[mail] sent to=${to} subject="${subject}"`);
    return;
  }
  if (process.env.NODE_ENV === "production" && process.env.DEV_MAILBOX !== "1") {
    throw new Error("RESEND_API_KEY is required in production.");
  }
  const db = await getDb();
  await db.insert(outboundEmails).values({ to, subject, body });
  if (process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "production") {
    console.info(`[mail] to=${to} subject="${subject}"\n${body}`);
  }
}

export async function issueToken(userId: string, type: "verify_email" | "reset_password") {
  const db = await getDb();
  const token = randomToken();
  const hours = type === "verify_email" ? 48 : 1;
  await db.insert(authTokens).values({ id: sha256(token), userId, type, expiresAt: new Date(Date.now() + hours * 3_600_000) });
  return token;
}

export async function consumeToken(token: string, type: "verify_email" | "reset_password") {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.id, sha256(token)), eq(authTokens.type, type), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())));
  if (!row) return null;
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  return row.userId;
}

/** True when a verify_email token was already consumed by a link scanner but is still within its expiry window. */
export async function isRecentlyVerifiedEmailToken(token: string): Promise<boolean> {
  if (!token) return false;
  const db = await getDb();
  const [row] = await db
    .select({ verifiedAt: users.emailVerifiedAt })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(and(eq(authTokens.id, sha256(token)), eq(authTokens.type, "verify_email"), gt(authTokens.expiresAt, new Date())));
  return Boolean(row?.verifiedAt);
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email">) {
  const token = await issueToken(user.id, "verify_email");
  await sendEmail(user.email, "Verify your email", `Confirm your email address:\n${appUrl()}/verify?token=${token}`);
}

export function devMailboxEnabled() {
  if (process.env.RESEND_API_KEY || process.env.NODE_ENV === "production") return false;
  return true;
}
