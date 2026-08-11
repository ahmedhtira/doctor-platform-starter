import { describe, expect, it } from "vitest";
import { isPlatformAdminUserId } from "@/lib/admin/is-platform-admin";

const ADMIN_ID = "aaaaaaaa-1111-1111-1111-111111111111";
const OTHER_ID = "bbbbbbbb-2222-2222-2222-222222222222";

describe("isPlatformAdminUserId (M10)", () => {
  it("returns true when the ids match exactly", () => {
    expect(isPlatformAdminUserId(ADMIN_ID, ADMIN_ID)).toBe(true);
  });

  it("returns false for a different, well-formed user id", () => {
    expect(isPlatformAdminUserId(OTHER_ID, ADMIN_ID)).toBe(false);
  });

  it("returns false for null/undefined/empty caller ids", () => {
    expect(isPlatformAdminUserId(null, ADMIN_ID)).toBe(false);
    expect(isPlatformAdminUserId(undefined, ADMIN_ID)).toBe(false);
    expect(isPlatformAdminUserId("", ADMIN_ID)).toBe(false);
  });

  it("does not case-fold — a differently-cased match is rejected", () => {
    expect(isPlatformAdminUserId(ADMIN_ID.toUpperCase(), ADMIN_ID)).toBe(false);
  });
});
