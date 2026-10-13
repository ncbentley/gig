import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secret";

describe("encryptSecret", () => {
  it("decrypts a value it just encrypted", () => {
    const stored = encryptSecret("021000021");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptSecret(stored)).toBe("021000021");
  });
});
