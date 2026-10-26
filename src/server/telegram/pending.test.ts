import { describe, expect, it } from "vitest";
import { readPendingTelegram, signPendingTelegram } from "./pending";

const secret = "app-secret";
const nowMs = 1_700_000_000_000;

const payload = {
  id: "42",
  username: "ada" as string | null,
  authDate: 1_700_000_000,
  exp: nowMs + 60_000,
};

describe("pending telegram cookie", () => {
  it("signs a payload and reads it back before exp", () => {
    const cookie = signPendingTelegram(payload, secret);
    expect(cookie).toMatch(/^[0-9a-f]+\.[A-Za-z0-9_-]+$/);
    expect(readPendingTelegram(cookie, secret, nowMs)).toEqual(payload);
  });

  it("rejects a cookie whose mac was changed", () => {
    const cookie = signPendingTelegram(payload, secret);
    const [mac, body] = cookie.split(".");
    const flipped = `${mac!.slice(0, -1)}${mac!.endsWith("0") ? "1" : "0"}.${body}`;
    expect(readPendingTelegram(flipped, secret, nowMs)).toBeNull();
  });

  it("rejects a cookie whose exp is not in the future", () => {
    const cookie = signPendingTelegram(payload, secret);
    expect(readPendingTelegram(cookie, secret, payload.exp)).toBeNull();
    expect(readPendingTelegram(cookie, secret, payload.exp + 1)).toBeNull();
  });
});
