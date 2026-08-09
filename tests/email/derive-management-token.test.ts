import { describe, expect, it } from "vitest";
import { deriveEmailManagementToken } from "@/lib/email/derive-management-token";
import { managementTokenPattern } from "@/lib/booking/generate-management-token";

// Proves the deterministic-derivation guarantee the whole M7 retry design
// rests on (PROJECT_SPEC.md's M7 section): given the same email_outbox
// id, every call — same process or not — must return the identical raw
// token.

describe("deriveEmailManagementToken (M7)", () => {
  it("returns the identical raw token for the same email_outbox id, every call", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const first = deriveEmailManagementToken(id);
    const second = deriveEmailManagementToken(id);
    const third = deriveEmailManagementToken(id);

    expect(second.rawToken).toBe(first.rawToken);
    expect(third.rawToken).toBe(first.rawToken);
    expect(second.tokenHash).toBe(first.tokenHash);
  });

  it("returns different tokens for different email_outbox ids", () => {
    const a = deriveEmailManagementToken("11111111-1111-1111-1111-111111111111");
    const b = deriveEmailManagementToken("22222222-2222-2222-2222-222222222222");

    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("output matches the exact shape /manage's token parsing already validates", () => {
    const { rawToken, tokenHash } = deriveEmailManagementToken("33333333-3333-3333-3333-333333333333");

    expect(rawToken).toMatch(managementTokenPattern);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rawToken).not.toBe(tokenHash);
  });
});
