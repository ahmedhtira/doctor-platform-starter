import { createHash, randomBytes } from "node:crypto";

/**
 * Raw token + its SHA-256 hash. Same pattern already proven in the M1/M3
 * test suites (tests/db/management-tokens.test.ts,
 * tests/availability/sql-consistency.test.ts's booking helpers) — the raw
 * value is generated here, in trusted Next.js server code, and must never
 * be persisted anywhere. Only `tokenHash` goes into Postgres.
 */
export function generateManagementToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, tokenHash };
}
