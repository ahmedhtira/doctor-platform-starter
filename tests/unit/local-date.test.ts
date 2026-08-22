import { describe, expect, it } from "vitest";
import { isoDateInTimeZone } from "@/lib/datetime/local-date";

describe("isoDateInTimeZone", () => {
  it("uses the clinic date rather than UTC around Tunis midnight", () => {
    const instant = new Date("2026-08-22T23:30:00.000Z");

    expect(isoDateInTimeZone("Africa/Tunis", instant)).toBe("2026-08-23");
    expect(isoDateInTimeZone("UTC", instant)).toBe("2026-08-22");
  });

  it("handles a timezone on the previous calendar date", () => {
    const instant = new Date("2026-08-23T00:30:00.000Z");

    expect(isoDateInTimeZone("America/New_York", instant)).toBe("2026-08-22");
  });
});
