import { generateOpaqueSecret, hashSecret } from "./crypto-secret";

/** randomBytes(32) hex-encoded -> 64 lowercase hex characters. */
export const MANAGEMENT_TOKEN_BYTE_LENGTH = 32;

/**
 * Single source of truth for the raw management token's shape, so
 * generation and validation (e.g. the Zod schema that parses a token read
 * out of a `/manage#token=...` URL fragment) can never drift apart.
 */
export const managementTokenPattern = new RegExp(`^[0-9a-f]{${MANAGEMENT_TOKEN_BYTE_LENGTH * 2}}$`);

export const hashManagementToken = hashSecret;

/**
 * Raw token + its SHA-256 hash. Same pattern already proven in the M1/M3
 * test suites (tests/db/management-tokens.test.ts,
 * tests/availability/sql-consistency.test.ts's booking helpers) — the raw
 * value is generated here, in trusted Next.js server code, and must never
 * be persisted anywhere. Only `tokenHash` goes into Postgres.
 */
export function generateManagementToken(): { rawToken: string; tokenHash: string } {
  const { rawSecret, secretHash } = generateOpaqueSecret(MANAGEMENT_TOKEN_BYTE_LENGTH);
  return { rawToken: rawSecret, tokenHash: secretHash };
}
