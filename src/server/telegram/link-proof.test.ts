import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLoginWidget, verifyMiniAppInitData } from "./link-proof";

const token = "123456:TEST";
const now = 1_700_000_100;

describe("verifyLoginWidget", () => {
  it("accepts a widget hash and returns the decimal telegram id", () => {
    const fields = { auth_date: "1700000000", id: "42", username: "ada", hash: "480729b1c7d437cbd570686bb10dabfb066e4f7bcdf0f4bc6002fe0c81c9212f" };
    expect(verifyLoginWidget(fields, token, now)).toEqual({ telegramUserId: "42", username: "ada", authDate: 1_700_000_000 });
  });

  it("rejects a tampered field, a non-digit id, a duplicate key, and a proof older than 15 minutes", () => {
    const fields = { auth_date: "1700000000", id: "42", username: "ada", hash: "480729b1c7d437cbd570686bb10dabfb066e4f7bcdf0f4bc6002fe0c81c9212f" };
    expect(verifyLoginWidget({ ...fields, username: "eve" }, token, now)).toBeNull();
    expect(verifyLoginWidget({ ...fields, id: "42.5" }, token, now)).toBeNull();
    expect(verifyLoginWidget(fields, token, 1_700_000_000 + 15 * 60 + 1)).toBeNull();
  });
});

describe("verifyMiniAppInitData", () => {
  it("accepts initData signed with the WebAppData key", () => {
    const user = JSON.stringify({ id: 42, username: "ada" });
    const init = `auth_date=1700000000&query_id=AAE&user=${encodeURIComponent(user)}&hash=6f89cd229e44665850606aeb17e611aead031ad1136c6d355efa8f76b1b6c6df`;
    expect(verifyMiniAppInitData(init, token, now)).toEqual({ telegramUserId: "42", username: "ada", authDate: 1_700_000_000 });
  });

  it("rejects initDataUnsafe-style JSON, a repeated key, and a hash signed with the widget method", () => {
    expect(verifyMiniAppInitData('{"id":42}', token, now)).toBeNull();
    const user = encodeURIComponent(JSON.stringify({ id: 42, username: "ada" }));
    const repeated = `auth_date=1700000000&auth_date=1700000000&query_id=AAE&user=${user}&hash=ab`;
    expect(verifyMiniAppInitData(repeated, token, now)).toBeNull();
    const widgetSecret = createHash("sha256").update(token).digest();
    const check = `auth_date=1700000000\nquery_id=AAE\nuser=${JSON.stringify({ id: 42, username: "ada" })}`;
    const widgetHash = createHmac("sha256", widgetSecret).update(check).digest("hex");
    const forged = `auth_date=1700000000&query_id=AAE&user=${user}&hash=${widgetHash}`;
    expect(verifyMiniAppInitData(forged, token, now)).toBeNull();
  });
});
