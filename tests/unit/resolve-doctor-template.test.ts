import { describe, expect, it, vi } from "vitest";

// The real standard-doctor-page.tsx transitively imports getTranslations
// from "next-intl/server", which imports the "server-only" marker
// package — that package throws unconditionally unless resolved under
// Next's own react-server build condition (not something plain Vitest
// sets up, and not worth wiring for a one-file dispatch test). Mocking
// both template modules keeps this test focused on resolveDoctorTemplate's
// actual pure logic — which component reference it returns for a given
// (page_variant, custom_template_key) pair — without needing to render
// or even load either real template.
const { StandardDoctorPageFake, DrAmiraPremiumTemplateFake } = vi.hoisted(() => ({
  StandardDoctorPageFake: () => "standard",
  DrAmiraPremiumTemplateFake: () => "custom",
}));

vi.mock("@/components/doctors/templates/standard-doctor-page", () => ({
  StandardDoctorPage: StandardDoctorPageFake,
}));
vi.mock("@/components/doctors/templates/dr-amira-premium", () => ({
  DrAmiraPremiumTemplate: DrAmiraPremiumTemplateFake,
}));

import { CUSTOM_TEMPLATE_KEYS, resolveDoctorTemplate } from "@/components/doctors/templates/registry";

describe("resolveDoctorTemplate (M10)", () => {
  it("returns the standard template for page_variant 'standard', regardless of custom_template_key", () => {
    expect(resolveDoctorTemplate("standard", null)).toBe(StandardDoctorPageFake);
    expect(resolveDoctorTemplate("standard", "dr-amira-premium")).toBe(StandardDoctorPageFake);
  });

  it("returns the registered custom template for a valid key", () => {
    expect(resolveDoctorTemplate("custom", "dr-amira-premium")).toBe(DrAmiraPremiumTemplateFake);
  });

  it("falls back to the standard template for a missing custom_template_key", () => {
    expect(resolveDoctorTemplate("custom", null)).toBe(StandardDoctorPageFake);
  });

  it("falls back to the standard template for an unregistered custom_template_key", () => {
    expect(resolveDoctorTemplate("custom", "not-a-real-template")).toBe(StandardDoctorPageFake);
  });

  it("lists every registered key in CUSTOM_TEMPLATE_KEYS", () => {
    expect(CUSTOM_TEMPLATE_KEYS).toContain("dr-amira-premium");
  });
});
