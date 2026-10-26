import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/telegram/link/[state]", () => {
  it("redirects a repeated query key to the invalid account state", async () => {
    const request = new Request("http://localhost/api/telegram/link/browser-state?id=1&id=2");
    try {
      await GET(request, { params: Promise.resolve({ state: "browser-state" }) });
      expect.unreachable("GET should redirect");
    } catch (error) {
      const digest = (error as { digest?: string }).digest ?? "";
      expect(digest).toContain("NEXT_REDIRECT");
      expect(digest).toContain("/account?telegram=invalid");
    }
  });
});
