import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { applyMiniAppCors } from "@/server/http/cors";

const ENTITLEMENTS = "https://goldintelligencegateway.com/api/v1/me/entitlements";

function expectMiniAppCors(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
  expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
}

describe("Mini App CORS", () => {
  it("sets the three allow headers and does not allow credentials", () => {
    const response = applyMiniAppCors(new Response(null, { status: 200 }));
    expectMiniAppCors(response);
  });

  it("answers /api/v1 OPTIONS with 204, an empty body, and the CORS headers", async () => {
    const response = proxy(new NextRequest(ENTITLEMENTS, { method: "OPTIONS" }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectMiniAppCors(response);
  });

  it("copies the CORS headers onto other /api/v1 responses", () => {
    const response = proxy(new NextRequest(ENTITLEMENTS, { method: "GET" }));
    expectMiniAppCors(response);
  });

  it("leaves non-API responses without an allow-origin header", () => {
    const response = proxy(new NextRequest("https://goldintelligencegateway.com/account", { method: "GET" }));
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
