const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createReferralCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}
