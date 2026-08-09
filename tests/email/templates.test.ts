import { describe, expect, it } from "vitest";
import { renderOutboxEmail } from "@/lib/email/render-outbox-email";
import type { EmailOutboxPayload } from "@/lib/email/outbox-payload";

// Renders all 4 v1 templates in fr/ar directly (no DB needed — a
// synthetic payload matching emailOutboxPayloadSchema is enough), per
// PROJECT_SPEC.md's M7 section.

const PAYLOAD: EmailOutboxPayload = {
  appointment_id: "11111111-1111-1111-1111-111111111111",
  doctor_name: "Dr. Test",
  clinic_name: "Clinique Test",
  clinic_address: "1 Rue Test",
  clinic_timezone: "Africa/Tunis",
  appointment_type_name: "Consultation",
  patient_name: "Patient Test",
  starts_at: "2031-01-01T09:00:00+00:00",
  ends_at: "2031-01-01T09:30:00+00:00",
};

const MANAGEMENT_LINK = "http://localhost:3000/fr/manage#token=" + "a".repeat(64);

const LINK_BEARING_TEMPLATES = [
  "appointment_confirmation",
  "appointment_reschedule_patient",
  "appointment_reschedule_staff",
] as const;

describe("renderOutboxEmail — v1 templates (M7)", () => {
  for (const locale of ["fr", "ar"] as const) {
    for (const template of LINK_BEARING_TEMPLATES) {
      it(`renders ${template} in ${locale} without throwing, with the link present`, async () => {
        const result = await renderOutboxEmail({
          template,
          templateVersion: 1,
          payload: PAYLOAD,
          locale,
          managementLink: MANAGEMENT_LINK,
        });

        expect(result.subject.length).toBeGreaterThan(0);
        expect(result.html).toContain(PAYLOAD.doctor_name);
        expect(result.html).toContain(MANAGEMENT_LINK);
        expect(result.text).toContain(PAYLOAD.doctor_name);
        expect(result.html).toContain(locale === "ar" ? 'dir="rtl"' : 'dir="ltr"');
      });
    }

    it(`renders appointment_cancellation in ${locale} without a link anywhere`, async () => {
      const result = await renderOutboxEmail({
        template: "appointment_cancellation",
        templateVersion: 1,
        payload: PAYLOAD,
        locale,
        managementLink: null,
      });

      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.html).toContain(PAYLOAD.doctor_name);
      expect(result.html).not.toContain("/manage#token=");
      expect(result.html).toContain(locale === "ar" ? 'dir="rtl"' : 'dir="ltr"');
    });
  }

  it("distinguishes staff-initiated from patient-initiated reschedule copy", async () => {
    const patientVersion = await renderOutboxEmail({
      template: "appointment_reschedule_patient",
      templateVersion: 1,
      payload: PAYLOAD,
      locale: "fr",
      managementLink: MANAGEMENT_LINK,
    });
    const staffVersion = await renderOutboxEmail({
      template: "appointment_reschedule_staff",
      templateVersion: 1,
      payload: PAYLOAD,
      locale: "fr",
      managementLink: MANAGEMENT_LINK,
    });

    expect(patientVersion.html).not.toBe(staffVersion.html);
  });

  it("throws a clear error for an unrecognized (template, template_version) combination", async () => {
    await expect(
      renderOutboxEmail({
        template: "appointment_confirmation",
        templateVersion: 2,
        payload: PAYLOAD,
        locale: "fr",
        managementLink: MANAGEMENT_LINK,
      }),
    ).rejects.toThrow(/unknown email template\/version/i);

    await expect(
      renderOutboxEmail({
        template: "some_future_template",
        templateVersion: 1,
        payload: PAYLOAD,
        locale: "fr",
        managementLink: MANAGEMENT_LINK,
      }),
    ).rejects.toThrow(/unknown email template\/version/i);
  });

  it("throws if a link-bearing template is rendered without a managementLink", async () => {
    await expect(
      renderOutboxEmail({
        template: "appointment_confirmation",
        templateVersion: 1,
        payload: PAYLOAD,
        locale: "fr",
        managementLink: null,
      }),
    ).rejects.toThrow(/managementLink/);
  });
});
