import { describe, expect, it } from "vitest";
import { renderAccountEmail } from "@/lib/email/render-account-email";

// Renders the two M10 account-security templates in fr/ar directly (no
// DB needed — this dispatcher is deliberately separate from
// render-outbox-email.ts and never touches email_outbox). See
// PROJECT_SPEC.md's M10 section.

const ACTION_LINK = "http://127.0.0.1:54321/auth/v1/verify?token=" + "a".repeat(64);

describe("renderAccountEmail — v1 templates (M10)", () => {
  for (const locale of ["fr", "ar"] as const) {
    it(`renders doctor_invite in ${locale} with the action link present`, async () => {
      const result = await renderAccountEmail({ template: "doctor_invite", locale, actionLink: ACTION_LINK });

      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.html).toContain(ACTION_LINK);
      expect(result.text).toContain(ACTION_LINK);
      expect(result.html).toContain(locale === "ar" ? 'dir="rtl"' : 'dir="ltr"');
    });

    it(`renders password_reset in ${locale} with the action link present`, async () => {
      const result = await renderAccountEmail({ template: "password_reset", locale, actionLink: ACTION_LINK });

      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.html).toContain(ACTION_LINK);
      expect(result.text).toContain(ACTION_LINK);
      expect(result.html).toContain(locale === "ar" ? 'dir="rtl"' : 'dir="ltr"');
    });
  }

  it("distinguishes doctor_invite from password_reset copy", async () => {
    const invite = await renderAccountEmail({ template: "doctor_invite", locale: "fr", actionLink: ACTION_LINK });
    const reset = await renderAccountEmail({ template: "password_reset", locale: "fr", actionLink: ACTION_LINK });

    expect(invite.html).not.toBe(reset.html);
    expect(invite.subject).not.toBe(reset.subject);
  });
});
