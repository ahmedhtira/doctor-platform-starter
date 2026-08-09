import { createHash, randomBytes } from "node:crypto";

/**
 * Shared primitive behind every opaque, single-use-or-short-lived secret
 * this app hands to a browser (management tokens, management session
 * secrets): generate high-entropy random bytes in trusted server code, hash
 * them, and only ever persist the hash. The raw value must never reach
 * Postgres, logs, or any response other than the one transient place it's
 * meant to be used (a Set-Cookie header, a confirmation-screen link).
 */
export function generateOpaqueSecret(byteLength: number): {
  rawSecret: string;
  secretHash: string;
} {
  const rawSecret = randomBytes(byteLength).toString("hex");
  return { rawSecret, secretHash: hashSecret(rawSecret) };
}

export function hashSecret(rawSecret: string): string {
  return createHash("sha256").update(rawSecret).digest("hex");
}
