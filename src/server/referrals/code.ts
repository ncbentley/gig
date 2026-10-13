const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isReferralCode(value: string) {
  if (value.length !== 8) return false;
  for (const char of value) {
    if (!ALPHABET.includes(char)) return false;
  }
  return true;
}

export function createReferralCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}
