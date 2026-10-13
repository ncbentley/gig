import { decryptSecret, encryptSecret } from "./secret";
it("decrypts a value it just encrypted", () => {
  const stored = encryptSecret("021000021");
  expect(stored.startsWith("v1.")).toBe(true);
  expect(decryptSecret(stored)).toBe("021000021");
});
