import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GigActivityDeliveryError, sendGigEvent } from "./send";

const key = "a".repeat(64);

describe("sendGigEvent", () => {
  it("signs timestamp.body and posts only id, kind, occurred_at", async () => {
    let calls = 0;
    const result = await sendGigEvent(
      { id: "signup:unit-test", kind: "signup", occurred_at: 1700000000 },
      {
        key,
        fetcher: async (url, options) => {
          calls += 1;
          expect(url).toBe("https://book.aetherionnetwork.com/book/gig-activity");
          expect(options.method).toBe("POST");
          expect(options.redirect).toBe("error");
          expect(options.headers["Content-Type"]).toBe("application/json");
          expect(options.headers["X-Gig-Signature"]).toBe(
            createHmac("sha256", key).update(`${options.headers["X-Gig-Timestamp"]}.${options.body}`).digest("hex"),
          );
          expect(JSON.parse(options.body)).toEqual({
            id: "signup:unit-test",
            kind: "signup",
            occurred_at: 1700000000,
          });
          expect(Object.keys(JSON.parse(options.body))).toEqual(["id", "kind", "occurred_at"]);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ accepted: true, duplicate: false }),
          };
        },
      },
    );
    expect(calls).toBe(1);
    expect(result).toEqual({ accepted: true, duplicate: false });
  });

  it("treats duplicate:true as accepted", async () => {
    const result = await sendGigEvent(
      { id: "signup:unit-test", kind: "signup", occurred_at: 1700000000 },
      {
        key,
        fetcher: async () => ({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ accepted: true, duplicate: true }),
        }),
      },
    );
    expect(result.duplicate).toBe(true);
  });

  it("does not call the network for a bad kind or short id", async () => {
    await expect(
      sendGigEvent({ id: "x", kind: "bad", occurred_at: 1 }, { key, fetcher: () => { throw new Error("Must not call network"); } }),
    ).rejects.toThrow(/Invalid event kind|opaque event ID/);
  });

  it("marks 400 and 403 as not retryable", async () => {
    const fail = (status: number) =>
      sendGigEvent(
        { id: "signup:unit-test", kind: "signup", occurred_at: 1700000000 },
        {
          key,
          fetcher: async () => ({
            ok: false,
            status,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ error: "no" }),
          }),
        },
      );
    await expect(fail(400)).rejects.toMatchObject({ retryable: false, code: "http_400" });
    await expect(fail(403)).rejects.toMatchObject({ retryable: false, code: "http_403" });
    await expect(fail(400)).rejects.toBeInstanceOf(GigActivityDeliveryError);
  });

  it("marks timeout, 500, and HTML challenge as retryable", async () => {
    await expect(
      sendGigEvent(
        { id: "signup:unit-test", kind: "signup", occurred_at: 1700000000 },
        {
          key,
          fetcher: async () => {
            throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
          },
        },
      ),
    ).rejects.toMatchObject({ retryable: true, code: "timeout" });

    await expect(
      sendGigEvent(
        { id: "signup:unit-test", kind: "signup", occurred_at: 1700000000 },
        {
          key,
          fetcher: async () => ({
            ok: false,
            status: 500,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ error: "no" }),
          }),
        },
      ),
    ).rejects.toMatchObject({ retryable: true, code: "http_5xx" });

    await expect(
      sendGigEvent(
        { id: "signup:unit-test", kind: "signup", occurred_at: 1700000000 },
        {
          key,
          fetcher: async () => ({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "text/html" }),
            json: async () => ({}),
          }),
        },
      ),
    ).rejects.toMatchObject({ retryable: true, code: "challenge" });
  });
});
