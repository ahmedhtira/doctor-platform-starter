import { test, expect } from "@playwright/test";

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
