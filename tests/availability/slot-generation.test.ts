import { describe, expect, it } from "vitest";
import {
  computeAvailableSlots,
  type ComputeAvailableSlotsInput,
} from "@/lib/availability/compute-available-slots";

// Africa/Tunis is fixed UTC+1 year-round (no DST) — used throughout so
// slot instants are predictable and directly comparable to
// tests/db/compute-available-slots.test.ts's SQL-side expectations.
const CLINIC_TIMEZONE = "Africa/Tunis";
const LOCAL_DATE = "2030-01-07";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();
const FAR_PAST_NOW = "2029-01-01T00:00:00Z";

function baseInput(overrides: Partial<ComputeAvailableSlotsInput> = {}): ComputeAvailableSlotsInput {
  return {
    clinicTimezone: CLINIC_TIMEZONE,
    appointmentDurationMinutes: 30,
    minBookingNoticeMinutes: 60,
    localDate: LOCAL_DATE,
    now: FAR_PAST_NOW,
    workingHours: [],
    breaks: [],
    blockedPeriods: [],
    scheduleExceptions: [],
    existingAppointments: [],
    ...overrides,
  };
}

describe("computeAvailableSlots", () => {
  it("derives 30-minute slots from recurring working hours, converted from Africa/Tunis", () => {
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: [{ dayOfWeek: DAY_OF_WEEK, startTime: "09:00", endTime: "11:00" }],
      }),
    );

    expect(slots).toHaveLength(4);
    // 09:00 Tunis = 08:00 UTC (fixed UTC+1, no DST).
    expect(slots[0].slotStart).toBe("2030-01-07T08:00:00Z");
    expect(slots[3].slotEnd).toBe("2030-01-07T10:00:00Z");
  });

  it("returns no slots for a day with no working hours and no exception", () => {
    expect(computeAvailableSlots(baseInput())).toHaveLength(0);
  });

  it("subtracts a break from the working window", () => {
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: [{ dayOfWeek: DAY_OF_WEEK, startTime: "09:00", endTime: "11:00" }],
        breaks: [{ dayOfWeek: DAY_OF_WEEK, startTime: "10:00", endTime: "10:30" }],
      }),
    );

    // Break is 10:00-10:30 Tunis = 09:00-09:30 UTC — that slot is gone,
    // the untouched 08:00 UTC slot is not.
    expect(slots).toHaveLength(3);
    expect(slots.some((s) => s.slotStart === "2030-01-07T08:00:00Z")).toBe(true);
    expect(slots.some((s) => s.slotStart === "2030-01-07T09:00:00Z")).toBe(false);
  });

  it("subtracts a blocked period from the working window", () => {
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: [{ dayOfWeek: DAY_OF_WEEK, startTime: "09:00", endTime: "11:00" }],
        blockedPeriods: [{ startsAt: "2030-01-07T08:30:00Z", endsAt: "2030-01-07T09:00:00Z" }],
      }),
    );

    expect(slots).toHaveLength(3);
    expect(slots.some((s) => s.slotStart === "2030-01-07T08:30:00Z")).toBe(false);
  });

  it("schedule exception: closes a normally-open date", () => {
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: [{ dayOfWeek: DAY_OF_WEEK, startTime: "09:00", endTime: "11:00" }],
        scheduleExceptions: [{ date: LOCAL_DATE, isClosed: true, startTime: null, endTime: null }],
      }),
    );

    expect(slots).toHaveLength(0);
  });

  it("schedule exception: opens a normally-closed date with custom hours", () => {
    const slots = computeAvailableSlots(
      baseInput({
        // deliberately no working_hours rule for DAY_OF_WEEK
        scheduleExceptions: [
          { date: LOCAL_DATE, isClosed: false, startTime: "14:00", endTime: "15:00" },
        ],
      }),
    );

    expect(slots).toHaveLength(2);
    expect(slots[0].slotStart).toBe("2030-01-07T13:00:00Z");
  });

  it("schedule exception: substitutes exceptional hours over the recurring pattern", () => {
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: [{ dayOfWeek: DAY_OF_WEEK, startTime: "09:00", endTime: "11:00" }],
        scheduleExceptions: [
          { date: LOCAL_DATE, isClosed: false, startTime: "13:00", endTime: "14:00" },
        ],
      }),
    );

    expect(slots).toHaveLength(2);
    expect(slots[0].slotStart).toBe("2030-01-07T12:00:00Z");
  });

  it("respects the appointment type's duration when chunking slots", () => {
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: [{ dayOfWeek: DAY_OF_WEEK, startTime: "09:00", endTime: "11:00" }],
        appointmentDurationMinutes: 60,
      }),
    );

    expect(slots).toHaveLength(2);
  });

  it("excludes slots inside the minimum booking notice window", () => {
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: [{ dayOfWeek: DAY_OF_WEEK, startTime: "09:00", endTime: "11:00" }],
        minBookingNoticeMinutes: 90,
        // now=07:30 UTC + 90 min notice = 09:00 UTC cutoff.
        now: "2030-01-07T07:30:00Z",
      }),
    );

    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(new Date(slot.slotStart).getTime()).toBeGreaterThanOrEqual(
        new Date("2030-01-07T09:00:00Z").getTime(),
      );
    }
  });

  it("excludes a slot covered by an existing (confirmed) appointment", () => {
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: [{ dayOfWeek: DAY_OF_WEEK, startTime: "09:00", endTime: "11:00" }],
        existingAppointments: [{ startsAt: "2030-01-07T09:00:00Z", endsAt: "2030-01-07T09:30:00Z" }],
      }),
    );

    expect(slots).toHaveLength(3);
    expect(slots.some((s) => s.slotStart === "2030-01-07T09:00:00Z")).toBe(false);
  });

  it("maps Postgres day-of-week correctly at the Sunday/Saturday boundary", () => {
    // Sunday: Postgres dow = 0, Luxon weekday = 7.
    const sunday = "2030-01-06";
    const sundayDow = new Date(`${sunday}T00:00:00Z`).getUTCDay();
    expect(sundayDow).toBe(0);

    const sundaySlots = computeAvailableSlots(
      baseInput({
        localDate: sunday,
        workingHours: [{ dayOfWeek: 0, startTime: "09:00", endTime: "10:00" }],
      }),
    );
    expect(sundaySlots).toHaveLength(2);

    // Saturday: Postgres dow = 6, Luxon weekday = 6.
    const saturday = "2030-01-05";
    const saturdayDow = new Date(`${saturday}T00:00:00Z`).getUTCDay();
    expect(saturdayDow).toBe(6);

    const saturdaySlots = computeAvailableSlots(
      baseInput({
        localDate: saturday,
        workingHours: [{ dayOfWeek: 6, startTime: "09:00", endTime: "10:00" }],
      }),
    );
    expect(saturdaySlots).toHaveLength(2);
  });
});
