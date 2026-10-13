import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEV_SECRET_FILE = path.join(process.cwd(), ".data", "app-secret");

export type SecretKeySource = "env" | "dev-file" | "missing";

function secretMaterial(create: boolean): { key: Buffer | null; source: SecretKeySource } {
  if (process.env.APP_SECRET) return { key: createHash("sha256").update(process.env.APP_SECRET).digest(), source: "env" };
  if (process.env.NODE_ENV === "production") return { key: null, source: "missing" };
  if (!existsSync(DEV_SECRET_FILE)) {
    if (!create) return { key: null, source: "missing" };
    mkdirSync(path.dirname(DEV_SECRET_FILE), { recursive: true });
    writeFileSync(DEV_SECRET_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return { key: createHash("sha256").update(readFileSync(DEV_SECRET_FILE, "utf8").trim()).digest(), source: "dev-file" };
}

export function secretKeySource(): SecretKeySource {
  return secretMaterial(false).source;
}

export function encryptSecret(plain: string) {
  const { key } = secretMaterial(true);
  if (!key) throw new Error("APP_SECRET must be set to store credentials.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(value: string) {
  const { key } = secretMaterial(false);
  if (!key) throw new Error("APP_SECRET is not available to decrypt stored credentials.");
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1") throw new Error("Unknown settings encryption version");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
