import { describe, expect, it } from "vitest";
import { bookingSchema } from "@/lib/booking/booking-schema";

const VALID_INPUT = {
  doctorId: "3e460071-8b8c-450b-b406-3591a7182eaf",
  clinicId: "4e460071-8b8c-450b-b406-3591a7182eaf",
  appointmentTypeId: "5e460071-8b8c-450b-b406-3591a7182eaf",
  startsAt: "2030-01-07T09:00:00Z",
  patientName: "Amira Ben Salah",
  patientPhone: "+216 71 234 567",
  patientEmail: "patient@example.test",
};

describe("bookingSchema", () => {
  it("accepts valid input", () => {
    const result = bookingSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it("rejects a missing/empty full name", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, patientName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a single-character full name", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, patientName: "A" });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from the full name", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, patientName: "  Amira Ben Salah  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.patientName).toBe("Amira Ben Salah");
    }
  });

  it("rejects a phone number containing letters", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, patientPhone: "call-me-maybe" });
    expect(result.success).toBe(false);
  });

  it("rejects a too-short phone number", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, patientPhone: "123" });
    expect(result.success).toBe(false);
  });

  it("accepts a phone number with spaces, parentheses, and a leading +", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, patientPhone: "+216 (71) 234-567" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email address", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, patientEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid doctorId", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, doctorId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects a startsAt without an explicit offset", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, startsAt: "2030-01-07T09:00:00" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-datetime startsAt", () => {
    const result = bookingSchema.safeParse({ ...VALID_INPUT, startsAt: "not-a-date" });
    expect(result.success).toBe(false);
  });
});
