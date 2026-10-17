import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const TOKEN = "test-token";
const SECRET = "test-secret";

function update(message: unknown) {
  return new Request("http://localhost/api/telegram/ad-bot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": SECRET,
    },
    body: JSON.stringify({ message }),
  });
}

afterEach(() => {
  delete process.env.TELEGRAM_AD_BOT_TOKEN;
  delete process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET;
  delete process.env.APP_URL;
  vi.unstubAllGlobals();
});

describe("POST /api/telegram/ad-bot", () => {
  it("returns 503 when the token or secret is unset", async () => {
    process.env.TELEGRAM_AD_BOT_TOKEN = TOKEN;
    expect((await POST(update({ text: "hello", chat: { id: 1, type: "private" } }))).status).toBe(503);
    process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET = SECRET;
    delete process.env.TELEGRAM_AD_BOT_TOKEN;
    expect((await POST(update({ text: "hello", chat: { id: 1, type: "private" } }))).status).toBe(503);
  });

  it("returns 401 for a missing or wrong secret", async () => {
    process.env.TELEGRAM_AD_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET = SECRET;
    const missing = new Request("http://localhost/api/telegram/ad-bot", {
      method: "POST",
      body: "{}",
    });
    const wrong = new Request("http://localhost/api/telegram/ad-bot", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "other-secret" },
      body: "{}",
    });
    expect((await POST(missing)).status).toBe(401);
    expect((await POST(wrong)).status).toBe(401);
    expect(await POST(missing).then((res) => res.text())).toBe(await POST(wrong).then((res) => res.text()));
  });

  it("returns 400 for a body that is not JSON", async () => {
    process.env.TELEGRAM_AD_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET = SECRET;
    const res = await POST(
      new Request("http://localhost/api/telegram/ad-bot", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": SECRET },
        body: "nope",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ignores a null update", async () => {
    process.env.TELEGRAM_AD_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET = SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(
      new Request("http://localhost/api/telegram/ad-bot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": SECRET,
        },
        body: "null",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Ignored.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a group message", async () => {
    process.env.TELEGRAM_AD_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET = SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(update({ text: "/start spring_push", chat: { id: 1, type: "group" } }));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the campaign link for a private /start", async () => {
    process.env.TELEGRAM_AD_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET = SECRET;
    process.env.APP_URL = "https://goldintelligencegateway.com";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(update({ text: "/start spring_push", chat: { id: 42, type: "private" } }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: 42,
      text: [
        "Done following a thousand traders?",
        "",
        "Follow all of them.",
        "",
        "https://goldintelligencegateway.com/?utm_source=telegram&utm_medium=cpc&utm_campaign=spring_push",
      ].join("\n"),
    });
  });

  it("returns 500 when Telegram rejects or drops the send", async () => {
    process.env.TELEGRAM_AD_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET = SECRET;
    process.env.APP_URL = "https://goldintelligencegateway.com";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    expect((await POST(update({ text: "hello", chat: { id: 42, type: "private" } }))).status).toBe(500);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    expect((await POST(update({ text: "hello", chat: { id: 42, type: "private" } }))).status).toBe(500);
  });

  it("returns 500 when Telegram answers with a status other than 200", async () => {
    process.env.TELEGRAM_AD_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET = SECRET;
    process.env.APP_URL = "https://goldintelligencegateway.com";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 201 })));
    expect((await POST(update({ text: "hello", chat: { id: 42, type: "private" } }))).status).toBe(500);
  });
});
