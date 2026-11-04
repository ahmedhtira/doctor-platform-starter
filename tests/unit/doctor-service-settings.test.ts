import { describe, expect, it } from "vitest";
import {
  defaultDoctorServiceSettings,
  doctorServiceSettingsSchema,
  parseTndMillimes,
  serviceSettingsPayload,
} from "@/lib/admin/doctor-service-settings";
import { phoneHref } from "@/lib/doctor-profile/list-sos-doctors";
import { classifyBookingError } from "@/lib/booking/booking-errors";

describe("doctor SOS and payment configuration", () => {
  it("preserves exact millimes and accepts French decimal input", () => {
    expect(parseTndMillimes("20")).toBe(20000);
    expect(parseTndMillimes("20,125")).toBe(20125);
    expect(parseTndMillimes("0.001")).toBe(1);
    expect(parseTndMillimes(" 80.010 ")).toBe(80010);
  });
  it.each(["", "0", "-1", "1.0001", "1e3", "Infinity", "10000.001", "20abc"])(
    "rejects invalid money without rounding: %s",
    (value) => {
      expect(parseTndMillimes(value)).toBeNull();
    },
  );
  it("keeps both features off for existing doctors", () => {
    expect(doctorServiceSettingsSchema.safeParse(defaultDoctorServiceSettings).success).toBe(true);
    expect(serviceSettingsPayload(defaultDoctorServiceSettings)).toMatchObject({
      sosEnabled: false,
      paymentRequired: false,
      paymentAmountMillimes: null,
    });
  });
  it("requires a callable number before advertising 24-hour contact", () => {
    expect(
      doctorServiceSettingsSchema.safeParse({ ...defaultDoctorServiceSettings, sosEnabled: true })
        .success,
    ).toBe(false);
    expect(
      doctorServiceSettingsSchema.safeParse({
        ...defaultDoctorServiceSettings,
        sosEnabled: true,
        sosPhone: "------",
      }).success,
    ).toBe(false);
    expect(
      doctorServiceSettingsSchema.safeParse({
        ...defaultDoctorServiceSettings,
        sosEnabled: true,
        sosPhone: "+216 70 123 456",
      }).success,
    ).toBe(true);
  });
  it("requires both a positive price and refund terms for mandatory payment", () => {
    expect(
      doctorServiceSettingsSchema.safeParse({
        ...defaultDoctorServiceSettings,
        paymentRequired: true,
        paymentAmount: "20",
      }).success,
    ).toBe(false);
    const settings = {
      ...defaultDoctorServiceSettings,
      paymentRequired: true,
      paymentAmount: "20.125",
      paymentTerms: "Refund before 24 hours.",
    };
    expect(serviceSettingsPayload(settings)).toMatchObject({
      paymentAmountMillimes: 20125,
      paymentTerms: settings.paymentTerms,
    });
    expect(doctorServiceSettingsSchema.safeParse({ ...settings, paymentAmount: "0" }).success).toBe(
      false,
    );
  });
  it("keeps SOS independent of payment requirements", () => {
    const settings = {
      ...defaultDoctorServiceSettings,
      sosEnabled: true,
      sosPhone: "+21670123456",
    };
    expect(serviceSettingsPayload(settings).paymentRequired).toBe(false);
  });
  it("formats safe telephone links", () => {
    expect(phoneHref("+216 (70) 123-456")).toBe("tel:+21670123456");
    expect(phoneHref(null)).toBeNull();
    expect(phoneHref("javascript:alert(1)")).toBeNull();
  });
  it("reports a payment restriction distinctly from a scheduling failure", () => {
    expect(classifyBookingError("P0402")).toBe("PAYMENT_REQUIRED");
    expect(classifyBookingError("23P01")).toBe("SLOT_UNAVAILABLE");
  });
});
