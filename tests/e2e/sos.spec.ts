import { test, expect } from "@playwright/test";
import {
  cleanupUsers,
  createDoctorFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "../db/fixtures";

test.describe("SOS directory and prepayment notice", () => {
  test.describe.configure({ mode: "serial" });
  const admin = createServiceRoleClient();
  const userIds: string[] = [];
  let doctor: DoctorFixture;
  test.beforeAll(async () => {
    doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);
    const saved = await admin.rpc("update_doctor_with_services", {
      p_doctor_id: doctor.doctorId,
      p_services: {
        sosEnabled: true,
        sosPhone: "+216 70 123 456",
        sosArea: "Grand Tunis",
        paymentRequired: true,
        paymentMode: "deposit",
        paymentAmountMillimes: 20000,
        paymentTerms: "Annulation 24 heures avant le rendez-vous.",
        recipientName: "Private recipient",
        providerName: "Test",
        accountReference: "never-public-reference",
      },
    });
    if (saved.error) throw saved.error;
    const clinic = await admin.from("clinics").update({ city: "Tunis" }).eq("id", doctor.clinicId);
    if (clinic.error) throw clinic.error;
  });
  test.afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  test("French directory links to the doctor and a callable SOS number", async ({ page }) => {
    await page.goto("/fr/sos?city=Tunis");
    await expect(page.getByRole("heading", { name: "Médecins SOS 24h/24" })).toBeVisible();
    const profileLink = page.locator(`a[href="/fr/doctors/${doctor.slug}"]`);
    await expect(profileLink).toBeVisible();
    await expect(
      profileLink.locator("xpath=ancestor::article").getByRole("link", { name: /Appeler/ }),
    ).toHaveAttribute("href", "tel:+21670123456");
    await expect(page.getByText("never-public-reference")).toHaveCount(0);
    await profileLink.click();
    await expect(page.getByText("Acompte requis", { exact: false })).toBeVisible();
    await expect(page.getByText("Annulation 24 heures avant le rendez-vous.")).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Appeler/ })).toHaveAttribute(
      "href",
      "tel:+21670123456",
    );
  });

  test("Arabic directory preserves RTL layout on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ar/sos");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "أطباء SOS على مدار الساعة" })).toBeVisible();
    await expect(page.locator(`a[href="/ar/doctors/${doctor.slug}"]`)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test("unknown city has a useful empty state and filter reset", async ({ page }) => {
    await page.goto("/fr/sos?city=NoSuchCity");
    await expect(
      page.getByRole("heading", { name: "Aucun médecin SOS disponible dans cette sélection" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Effacer le filtre" }).click();
    await expect(page).toHaveURL(/\/fr\/sos$/);
    await expect(page.locator(`a[href="/fr/doctors/${doctor.slug}"]`)).toBeVisible();
  });
});
