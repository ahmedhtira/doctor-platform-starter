import { test, expect } from "@playwright/test";
import {
  createServiceRoleClient,
  createTodayAppointmentFixture,
  createMultiDoctorSecretaryFixture,
  TEST_PASSWORD,
  type TodayAppointmentFixture,
  type MultiDoctorSecretaryFixture,
} from "./dashboard-fixtures";

// Requires the local Supabase stack running (npm run db:start) — unlike
// booking.spec.ts/manage.spec.ts, this file does NOT depend on
// `npm run db:seed`'s fixed amira-ben-salah doctor: every fixture here is
// created directly via dashboard-fixtures.ts (which builds on the existing
// tests/db/fixtures.ts service-role infrastructure) and torn down after
// each describe block, so nothing here touches the permanent dev seed.

const admin = createServiceRoleClient();

test.describe("dashboard: login, today, calendar, availability, logout", () => {
  let fixture: TodayAppointmentFixture;

  test.beforeAll(async () => {
    fixture = await createTodayAppointmentFixture(admin);
  });

  test.afterAll(async () => {
    await fixture.cleanup();
  });

  test("full staff flow through the real UI", async ({ page }) => {
    await page.goto("/fr/login");
    await page.getByLabel("Adresse e-mail").fill(fixture.doctor.user.email);
    await page.getByLabel("Mot de passe").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL(/\/fr\/dashboard$/);
    await expect(page.getByText("Dashboard E2E Patient")).toBeVisible();

    // Cancel the fixture appointment through the real UI.
    await page.getByRole("button", { name: "Annuler" }).click();
    await page.getByRole("button", { name: "Oui, annuler" }).click();
    await expect(page.getByText("Annulé")).toBeVisible();

    // Calendar: navigate there and page a week forward/back.
    await page.getByRole("link", { name: "Calendrier" }).click();
    await expect(page).toHaveURL(/\/dashboard\/calendar/);
    await page.getByRole("button", { name: "Semaine précédente" }).click();
    await page.getByRole("button", { name: "Semaine suivante" }).click();

    // Availability: add then remove a working-hours row.
    await page.getByRole("link", { name: "Disponibilités" }).click();
    await expect(page).toHaveURL(/\/dashboard\/availability/);

    await page.locator("#wh-day").selectOption("1");
    await page.locator("#wh-start").fill("08:00");
    await page.locator("#wh-end").fill("12:00");
    await page.getByRole("button", { name: "Ajouter" }).first().click();

    const workingHoursRow = page.getByText(/08:00–12:00/);
    await expect(workingHoursRow).toBeVisible();
    await page.getByRole("button", { name: "Supprimer" }).first().click();
    await expect(workingHoursRow).not.toBeVisible();

    // Logout, then confirm the dashboard is no longer reachable.
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/fr\/login/);
    await page.goto("/fr/dashboard");
    await expect(page).toHaveURL(/\/fr\/login/);
  });
});

test.describe("dashboard: doctor-context persistence across navigation", () => {
  let fixture: MultiDoctorSecretaryFixture;

  test.beforeAll(async () => {
    fixture = await createMultiDoctorSecretaryFixture(admin);
  });

  test.afterAll(async () => {
    await fixture.cleanup();
  });

  test("a secretary managing two doctors stays on the selected doctor through Today -> Calendar -> Availability -> Today", async ({
    page,
  }) => {
    await page.goto("/fr/login");
    await page.getByLabel("Adresse e-mail").fill(fixture.secretaryEmail);
    await page.getByLabel("Mot de passe").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/fr\/dashboard$/);

    const switcher = page.locator("#doctor-switcher");
    await expect(switcher).toBeVisible();
    await switcher.selectOption(fixture.doctorB.doctorId);
    await expect(switcher).toHaveValue(fixture.doctorB.doctorId);

    await page.getByRole("link", { name: "Calendrier" }).click();
    await expect(page).toHaveURL(/\/dashboard\/calendar/);
    await expect(switcher).toHaveValue(fixture.doctorB.doctorId);

    await page.getByRole("link", { name: "Disponibilités" }).click();
    await expect(page).toHaveURL(/\/dashboard\/availability/);
    await expect(switcher).toHaveValue(fixture.doctorB.doctorId);

    await page.getByRole("link", { name: "Aujourd'hui" }).click();
    await expect(page).toHaveURL(/\/fr\/dashboard/);
    await expect(switcher).toHaveValue(fixture.doctorB.doctorId);
  });
});
