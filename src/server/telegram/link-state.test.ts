import { describe, expect, it } from "vitest";
import { resolveTelegramLinkState } from "./link-state";

const valid = "a".repeat(43);

describe("resolveTelegramLinkState", () => {
  it("reuses a well-formed tg_link_state cookie and does not set another", () => {
    expect(resolveTelegramLinkState("/account", valid)).toEqual({ state: valid, cookie: null });
    expect(resolveTelegramLinkState("/account", "A".repeat(20))).toEqual({ state: "A".repeat(20), cookie: null });
    expect(resolveTelegramLinkState("/account", "z_-".repeat(10) + "ab")).toEqual({
      state: "z_-".repeat(10) + "ab",
      cookie: null,
    });
  });

  it("issues a new cookie when the state is missing or the wrong shape", () => {
    for (const existing of [undefined, null, "", "short", "a".repeat(201), "bad.token.value-aaaaaaaa", "has space-aaaaaaaaaaaa"]) {
      const issued = resolveTelegramLinkState("/account", existing);
      expect(issued?.state).toMatch(/^[A-Za-z0-9_-]{20,200}$/);
      expect(issued?.cookie).toMatchObject({
        name: "tg_link_state",
        value: issued?.state,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 900,
        secure: false,
      });
      expect(issued?.state).not.toBe(existing);
    }
  });

  it("does not issue state on any path other than /account", () => {
    expect(resolveTelegramLinkState("/dashboard", valid)).toBeNull();
    expect(resolveTelegramLinkState("/account/extra", valid)).toBeNull();
    expect(resolveTelegramLinkState("/api/telegram/link/abc", undefined)).toBeNull();
  });
});
