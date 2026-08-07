import { test, expect } from "@playwright/test";

// Requires the local Supabase stack running and seeded
// (npm run db:start && npm run db:reset && npm run db:seed).

test("homepage shows the search form and the seeded doctor as a result", async ({ page }) => {
  await page.goto("/fr");

  await expect(page.getByRole("heading", { name: "Recherche de médecins" })).toBeVisible();
  await expect(page.getByLabel("Spécialité")).toBeVisible();
  await expect(page.getByLabel("Ville")).toBeVisible();

  const card = page.locator('[data-slot="card"]').filter({ hasText: "Dr. Amira Ben Salah" });
  await expect(card.getByText("Cardiologie")).toBeVisible();
  await expect(card.getByText("Tunis")).toBeVisible();

  await page.getByRole("link", { name: "Voir le profil" }).click();
  await expect(page).toHaveURL(/\/fr\/doctors\/amira-ben-salah$/);
  await expect(page.locator("h1")).toHaveText("Dr. Amira Ben Salah");
});

test("filtering by specialty keeps the matching doctor", async ({ page }) => {
  await page.goto("/fr");

  await page.getByLabel("Spécialité").selectOption("cardiologie");
  await page.getByRole("button", { name: "Rechercher" }).click();

  await expect(page).toHaveURL(/specialty=cardiologie/);
  await expect(page.getByText("Dr. Amira Ben Salah")).toBeVisible();
});

test("filtering by a non-matching city shows the empty state", async ({ page }) => {
  await page.goto("/fr?city=Sfax");

  await expect(page.getByText("Aucun médecin ne correspond à votre recherche.")).toBeVisible();
  await expect(page.getByText("Dr. Amira Ben Salah")).not.toBeVisible();
});

test("patient header has no login link; staff portal is reachable only from the footer", async ({
  page,
}) => {
  await page.goto("/fr");

  await expect(page.locator("header").getByRole("link", { name: "Connexion" })).toHaveCount(0);

  const staffLink = page.locator("footer").getByRole("link", { name: "Espace médecin" });
  await expect(staffLink).toBeVisible();
  await staffLink.click();
  await expect(page).toHaveURL(/\/fr\/login$/);
});

test("renders the search page in Arabic with RTL layout", async ({ page }) => {
  await page.goto("/ar");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "البحث عن طبيب" })).toBeVisible();
  await expect(page.getByLabel("الاختصاص")).toBeVisible();
  await expect(page.getByRole("link", { name: "عرض الملف الشخصي" })).toBeVisible();
});
