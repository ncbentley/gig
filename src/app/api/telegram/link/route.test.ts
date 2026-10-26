import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/telegram/link", () => {
  it("rejects a callback that has no browser state in the path", async () => {
    const request = new Request("http://localhost/api/telegram/link?id=42&username=ada");
    try {
      await GET(request);
      expect.unreachable("GET should redirect");
    } catch (error) {
      const digest = (error as { digest?: string }).digest ?? "";
      expect(digest).toContain("NEXT_REDIRECT");
      expect(digest).toContain("/account?telegram=invalid");
    }
  });
});
