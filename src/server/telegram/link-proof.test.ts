import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLoginWidget, verifyMiniAppInitData } from "./link-proof";

const token = "123456:TEST";
const now = 1_700_000_100;

function compareKeys(a: string, b: string) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function widgetHash(fields: Record<string, string>, botToken: string) {
  const pairs = Object.entries(fields)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => compareKeys(a, b));
  const check = pairs.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  return createHmac("sha256", secret).update(check).digest("hex");
}

function miniAppHash(pairs: [string, string][], botToken: string) {
  const sorted = [...pairs].sort(([a], [b]) => compareKeys(a, b));
  const check = sorted.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(check).digest("hex");
}

describe("verifyLoginWidget", () => {
  it("accepts a widget hash and returns the decimal telegram id", () => {
    const fields = { auth_date: "1700000000", id: "42", username: "ada", hash: "480729b1c7d437cbd570686bb10dabfb066e4f7bcdf0f4bc6002fe0c81c9212f" };
    expect(verifyLoginWidget(fields, token, now)).toEqual({ telegramUserId: "42", username: "ada", authDate: 1_700_000_000 });
  });

  it("accepts a hash with uppercase hex digits", () => {
    const fields = { auth_date: "1700000000", id: "42", username: "ada", hash: "480729B1C7D437CBD570686BB10DABFB066E4F7BCDF0F4BC6002FE0C81C9212F" };
    expect(verifyLoginWidget(fields, token, now)).toEqual({ telegramUserId: "42", username: "ada", authDate: 1_700_000_000 });
  });

  it("rejects a tampered field and a proof older than 15 minutes", () => {
    const fields = { auth_date: "1700000000", id: "42", username: "ada", hash: "480729b1c7d437cbd570686bb10dabfb066e4f7bcdf0f4bc6002fe0c81c9212f" };
    expect(verifyLoginWidget({ ...fields, username: "eve" }, token, now)).toBeNull();
    expect(verifyLoginWidget(fields, token, 1_700_000_000 + 15 * 60 + 1)).toBeNull();
  });

  it("rejects a MAC-valid payload whose id is not all decimal digits", () => {
    const fields = { auth_date: "1700000000", id: "42.5", username: "ada" };
    expect(verifyLoginWidget({ ...fields, hash: widgetHash(fields, token) }, token, now)).toBeNull();
  });
});

describe("verifyMiniAppInitData", () => {
  it("accepts initData signed with the WebAppData key", () => {
    const user = JSON.stringify({ id: 42, username: "ada" });
    const init = `auth_date=1700000000&query_id=AAE&user=${encodeURIComponent(user)}&hash=6f89cd229e44665850606aeb17e611aead031ad1136c6d355efa8f76b1b6c6df`;
    expect(verifyMiniAppInitData(init, token, now)).toEqual({ telegramUserId: "42", username: "ada", authDate: 1_700_000_000 });
  });

  it("returns the exact decimal id from signed JSON without IEEE rounding", () => {
    const user = '{"id":9007199254740993,"username":"big"}';
    const pairs: [string, string][] = [
      ["auth_date", "1700000000"],
      ["query_id", "AAE"],
      ["user", user],
    ];
    const init = `auth_date=1700000000&query_id=AAE&user=${encodeURIComponent(user)}&hash=${miniAppHash(pairs, token)}`;
    expect(verifyMiniAppInitData(init, token, now)).toBeNull();
    const safeUser = '{"id":9007199254740992,"username":"big"}';
    const safePairs: [string, string][] = [
      ["auth_date", "1700000000"],
      ["query_id", "AAE"],
      ["user", safeUser],
    ];
    const safeInit = `auth_date=1700000000&query_id=AAE&user=${encodeURIComponent(safeUser)}&hash=${miniAppHash(safePairs, token)}`;
    expect(verifyMiniAppInitData(safeInit, token, now)).toEqual({
      telegramUserId: "9007199254740992",
      username: "big",
      authDate: 1_700_000_000,
    });
  });

  it("rejects initDataUnsafe-style JSON, malformed percent-encoding, and a hash signed with the widget method", () => {
    expect(verifyMiniAppInitData('{"id":42}', token, now)).toBeNull();
    expect(verifyMiniAppInitData("auth_date=1&user=%", token, now)).toBeNull();
    const user = encodeURIComponent(JSON.stringify({ id: 42, username: "ada" }));
    const widgetSecret = createHash("sha256").update(token).digest();
    const check = `auth_date=1700000000\nquery_id=AAE\nuser=${JSON.stringify({ id: 42, username: "ada" })}`;
    const widgetHashValue = createHmac("sha256", widgetSecret).update(check).digest("hex");
    const forged = `auth_date=1700000000&query_id=AAE&user=${user}&hash=${widgetHashValue}`;
    expect(verifyMiniAppInitData(forged, token, now)).toBeNull();
  });

  it("rejects a repeated key even when the hash matches the first copy only", () => {
    const userJson = JSON.stringify({ id: 42, username: "ada" });
    const userEnc = encodeURIComponent(userJson);
    const dedupedPairs: [string, string][] = [
      ["auth_date", "1700000000"],
      ["query_id", "AAE"],
      ["user", userJson],
    ];
    const validHash = miniAppHash(dedupedPairs, token);
    const repeated = `auth_date=1700000000&auth_date=9999999999&query_id=AAE&user=${userEnc}&hash=${validHash}`;
    expect(verifyMiniAppInitData(repeated, token, now)).toBeNull();
  });

  it("rejects null user JSON and a non-string username without throwing", () => {
    const nullUser = "null";
    const nullPairs: [string, string][] = [
      ["auth_date", "1700000000"],
      ["query_id", "AAE"],
      ["user", nullUser],
    ];
    const nullInit = `auth_date=1700000000&query_id=AAE&user=${encodeURIComponent(nullUser)}&hash=${miniAppHash(nullPairs, token)}`;
    expect(verifyMiniAppInitData(nullInit, token, now)).toBeNull();

    const badUsername = JSON.stringify({ id: 42, username: 7 });
    const badPairs: [string, string][] = [
      ["auth_date", "1700000000"],
      ["query_id", "AAE"],
      ["user", badUsername],
    ];
    const badInit = `auth_date=1700000000&query_id=AAE&user=${encodeURIComponent(badUsername)}&hash=${miniAppHash(badPairs, token)}`;
    expect(verifyMiniAppInitData(badInit, token, now)).toBeNull();
  });
});
