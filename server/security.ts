import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

function key(): Buffer {
  return createHmac("sha256", "crowdqueue-encryption-v1").update(config.encryptionKey).digest();
}

export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decrypt(value: string): string {
  const [iv, tag, payload] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(payload, undefined, "utf8") + decipher.final("utf8");
}

export function sign(value: string, purpose: string): string {
  const signature = createHmac("sha256", config.sessionSecret).update(`${purpose}:${value}`).digest("base64url");
  return `${value}.${signature}`;
}

export function verify(signed: string | undefined, purpose: string): string | null {
  if (!signed) return null;
  const split = signed.lastIndexOf(".");
  if (split < 1) return null;
  const value = signed.slice(0, split);
  const actual = Buffer.from(signed.slice(split + 1));
  const expected = Buffer.from(createHmac("sha256", config.sessionSecret).update(`${purpose}:${value}`).digest("base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? value : null;
}

export function matchesSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function ipDigest(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", config.sessionSecret).update(`${day}:${ip}`).digest("base64url");
}
