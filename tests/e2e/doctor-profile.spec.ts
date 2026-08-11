import { test, expect } from "@playwright/test";
import { createServiceRoleClient, createDoctorFixture, cleanupUsers } from "../db/fixtures";

// Requires the local Supabase stack running and seeded
// (npm run db:start && npm run db:reset && npm run db:seed).

test("renders the fictional doctor's profile in French with real data", async ({ page }) => {
  await page.goto("/fr/doctors/amira-ben-salah");

  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("h1")).toHaveText("Dr. Amira Ben Salah");
  await expect(page.getByText("Cardiologie", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Biographie" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Qualifications" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publications" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Livres" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Apparitions médiatiques" })).toBeVisible();
  await expect(page.getByText("Clinique El Manar")).toBeVisible();
});

test("renders the same profile in Arabic with RTL layout", async ({ page }) => {
  await page.goto("/ar/doctors/amira-ben-salah");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1")).toHaveText("Dr. Amira Ben Salah");
  await expect(page.getByText("أمراض القلب")).toBeVisible();
  await expect(page.getByRole("heading", { name: "السيرة الذاتية" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "المؤهلات" })).toBeVisible();
});

test("shows a localized not-found page for an unknown doctor slug", async ({ page }) => {
  const response = await page.goto("/fr/doctors/does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
});

// M10: page_variant/custom_template_key dispatch (registry.ts). Doesn't
// depend on the seeded amira-ben-salah doctor -- each fixture doctor is
// created directly via tests/db/fixtures.ts, published so the public route
// can serve it, and torn down afterward (same pattern dashboard.spec.ts
// already established for e2e-only fixtures).
test.describe("custom page-variant dispatch", () => {
  const admin = createServiceRoleClient();
  const userIds: string[] = [];

  test.afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  test("renders the registered custom template for a doctor with a valid custom_template_key", async ({
    page,
  }) => {
    const doctor = await createDoctorFixture(admin, {
      isPublished: true,
      pageVariant: "custom",
      customTemplateKey: "dr-amira-premium",
    });
    userIds.push(doctor.user.id);

    await page.goto(`/fr/doctors/${doctor.slug}`);

    await expect(page.getByText("Custom template: dr-amira-premium")).toBeVisible();
    await expect(page.locator("h1")).toHaveText("Dr. Test");
  });

  test("falls back to the standard page for an unregistered custom_template_key", async ({ page }) => {
    const doctor = await createDoctorFixture(admin, {
      isPublished: true,
      pageVariant: "custom",
      customTemplateKey: "not-a-real-template",
    });
    userIds.push(doctor.user.id);

    const response = await page.goto(`/fr/doctors/${doctor.slug}`);

    expect(response?.status()).toBe(200);
    await expect(page.getByText(/^Custom template:/)).toHaveCount(0);
    await expect(page.locator("h1")).toHaveText("Dr. Test");
  });

  test("falls back to the standard page when custom_template_key is missing entirely", async ({ page }) => {
    const doctor = await createDoctorFixture(admin, {
      isPublished: true,
      pageVariant: "custom",
      customTemplateKey: null,
    });
    userIds.push(doctor.user.id);

    const response = await page.goto(`/fr/doctors/${doctor.slug}`);

    expect(response?.status()).toBe(200);
    await expect(page.getByText(/^Custom template:/)).toHaveCount(0);
    await expect(page.locator("h1")).toHaveText("Dr. Test");
  });
});
