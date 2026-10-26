import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { signupAction } from "@/app/actions/auth";
import { createSession, sendVerificationEmail } from "@/server/auth";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { createMemberAccount } from "@/server/auth/register";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { telegramLinks, users } from "@/server/db/schema";
import { linkTelegram } from "@/server/telegram/links";
import { signPendingTelegram } from "@/server/telegram/pending";
import { finishPendingTelegramSignup } from "@/server/telegram/pending-signup";

const secret = "signup-action-secret";
const authDate = 1_700_000_000;

const cookieState = vi.hoisted(() => ({
  values: new Map<string, string>(),
  sets: [] as { name: string; value: string; options?: Record<string, unknown> }[],
}));

const headerState = vi.hoisted(() => ({
  headers: new Headers(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieState.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieState.values.set(name, value);
      cookieState.sets.push({ name, value, options });
    },
  }),
  headers: async () => headerState.headers,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/server/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth")>();
  return {
    ...actual,
    sendVerificationEmail: vi.fn(async () => {}),
    createSession: vi.fn(async () => {}),
  };
});

vi.mock("@/server/auth/register", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/register")>();
  return {
    ...actual,
    createMemberAccount: vi.fn(actual.createMemberAccount),
  };
});

vi.mock("@/server/telegram/pending-signup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/telegram/pending-signup")>();
  return {
    ...actual,
    finishPendingTelegramSignup: vi.fn(actual.finishPendingTelegramSignup),
  };
});

let events: string[] = [];
let actualFinish: typeof finishPendingTelegramSignup;
let actualCreate: typeof createMemberAccount;
const previousSecret = process.env.APP_SECRET;

function pendingCookie(id: string) {
  return signPendingTelegram(
    { id, username: "ada", authDate, exp: Date.now() + 60_000 },
    secret,
  );
}

function signupForm(email: string) {
  const form = new FormData();
  form.set("email", email);
  form.set("password", "password123");
  form.set("terms", "on");
  return form;
}

function cookieCleared() {
  return cookieState.sets.some(
    (set) =>
      set.name === "tg_pending" &&
      set.value === "" &&
      set.options?.httpOnly === true &&
      set.options?.sameSite === "lax" &&
      set.options?.path === "/" &&
      set.options?.maxAge === 0 &&
      set.options?.secure === (process.env.NODE_ENV === "production"),
  );
}

beforeAll(async () => {
  process.env.APP_SECRET = secret;
  actualFinish = vi.mocked(finishPendingTelegramSignup).getMockImplementation() as typeof finishPendingTelegramSignup;
  actualCreate = vi.mocked(createMemberAccount).getMockImplementation() as typeof createMemberAccount;
  await runMigrations();
}, 60_000);

beforeEach(() => {
  events = [];
  cookieState.values.clear();
  cookieState.sets.length = 0;
  headerState.headers = new Headers({ "x-forwarded-for": crypto.randomUUID() });
  resetRateLimits();
  vi.mocked(redirect).mockReset();
  vi.mocked(redirect).mockImplementation(() => {
    events.push("redirect");
  });
  vi.mocked(sendVerificationEmail).mockReset();
  vi.mocked(sendVerificationEmail).mockImplementation(async () => {
    events.push("email");
  });
  vi.mocked(createSession).mockReset();
  vi.mocked(createSession).mockImplementation(async () => {
    events.push("session");
  });
  vi.mocked(finishPendingTelegramSignup).mockReset();
  vi.mocked(finishPendingTelegramSignup).mockImplementation(async (input) => {
    const result = await actualFinish(input);
    events.push("error" in result ? "finish-error" : "finish-ok");
    return result;
  });
  vi.mocked(createMemberAccount).mockReset();
  vi.mocked(createMemberAccount).mockImplementation(actualCreate);
});

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = previousSecret;
  await closeDb();
});

describe("signupAction telegram pending", () => {
  it("links a valid pending cookie before the verification email and then starts a session", async () => {
    const email = `signup-ok-${crypto.randomUUID()}@example.com`;
    const telegramUserId = "810001";
    cookieState.values.set("tg_pending", pendingCookie(telegramUserId));
    vi.mocked(sendVerificationEmail).mockImplementation(async (user) => {
      const db = await getDb();
      const links = await db
        .select()
        .from(telegramLinks)
        .where(and(eq(telegramLinks.userId, user.id), isNull(telegramLinks.revokedAt)));
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ telegramUserId, telegramUsername: "ada", revokedAt: null });
      expect(cookieCleared()).toBe(true);
      expect(vi.mocked(createSession)).not.toHaveBeenCalled();
      events.push("email");
    });

    const result = await signupAction(undefined, signupForm(email));

    const db = await getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email));
    const links = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, user!.id));
    expect(user).toBeTruthy();
    expect(links).toHaveLength(1);
    expect(events).toEqual(["finish-ok", "email", "session", "redirect"]);
    expect(vi.mocked(createSession)).toHaveBeenCalledWith(user!.id);
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(`/check-email?email=${encodeURIComponent(email)}`);
    expect(result).toBeUndefined();
    await db.delete(users).where(eq(users.id, user!.id));
  });

  it("rejects an already linked telegram id before creating a user and keeps the cookie", async () => {
    const email = `signup-taken-${crypto.randomUUID()}@example.com`;
    const telegramUserId = "810002";
    const db = await getDb();
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    await linkTelegram({
      userId: owner!.id,
      telegramUserId,
      username: "owner",
      authDate: new Date(authDate * 1000),
    });
    const cookie = pendingCookie(telegramUserId);
    cookieState.values.set("tg_pending", cookie);

    const result = await signupAction(undefined, signupForm(email));

    expect(result).toEqual({ error: "That Telegram account is already connected. Sign in instead." });
    expect(events).toEqual([]);
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
    expect(vi.mocked(sendVerificationEmail)).not.toHaveBeenCalled();
    expect(cookieState.sets).toEqual([]);
    expect(cookieState.values.get("tg_pending")).toBe(cookie);
    const created = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect(created).toHaveLength(0);
    await db.delete(users).where(eq(users.id, owner!.id));
  });

  it("clears an unusable cookie and creates a normal account with no telegram link", async () => {
    const email = `signup-bad-${crypto.randomUUID()}@example.com`;
    cookieState.values.set("tg_pending", "not-a-cookie");

    await signupAction(undefined, signupForm(email));

    const db = await getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email));
    const links = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, user!.id));
    expect(user).toBeTruthy();
    expect(links).toHaveLength(0);
    expect(cookieCleared()).toBe(true);
    expect(events).toEqual(["email", "session", "redirect"]);
    expect(vi.mocked(createSession)).toHaveBeenCalledWith(user!.id);
    await db.delete(users).where(eq(users.id, user!.id));
  });

  it("keeps the new user and the cookie when linking throws after the account exists", async () => {
    const email = `signup-race-${crypto.randomUUID()}@example.com`;
    const telegramUserId = "810004";
    const db = await getDb();
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-race-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    cookieState.values.set("tg_pending", pendingCookie(telegramUserId));
    vi.mocked(createMemberAccount).mockImplementationOnce(async (input) => {
      const user = await actualCreate(input);
      await linkTelegram({
        userId: owner!.id,
        telegramUserId,
        username: "owner",
        authDate: new Date(authDate * 1000),
      });
      return user;
    });

    const result = await signupAction(undefined, signupForm(email));

    expect(result).toEqual({ error: "That Telegram account is already connected. Sign in instead." });
    expect(events).toEqual(["finish-error", "email"]);
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
    expect(vi.mocked(redirect)).not.toHaveBeenCalled();
    expect(cookieState.sets).toEqual([]);
    const [created] = await db.select().from(users).where(eq(users.email, email));
    const signupLinks = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, created!.id));
    const ownerLinks = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, owner!.id));
    expect(created).toBeTruthy();
    expect(signupLinks).toHaveLength(0);
    expect(ownerLinks).toHaveLength(1);
    expect(vi.mocked(sendVerificationEmail)).toHaveBeenCalledWith(expect.objectContaining({ id: created!.id, email }));
    await db.delete(users).where(eq(users.id, created!.id));
    await db.delete(users).where(eq(users.id, owner!.id));
  });
});
