import { test, expect } from "@playwright/test";

// Requires the local Supabase stack running and seeded
// (npm run db:start && npm run db:reset && npm run db:seed) — the seed
// script gives the fictional doctor Monday-Friday 09:00-17:00 hours with
// a lunch break, specifically so this flow has real slots to book.
//
// The conflict/concurrent-booking scenario is deliberately not duplicated
// here — it's precisely covered by the "under concurrent requests" test
// in tests/booking/book-appointment-flow.test.ts, which doesn't need a
// real browser to be a meaningful test of that behavior.

// A weekday a week out: always has working hours (seed only sets
// Mon-Fri), always far past the 60-minute minimum notice, and dodges
// same-day slots earlier manual/automated runs may have already booked
// against the persistent local DB.
function nextWeekdayIsoDate(daysOut: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysOut);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

test("books an appointment end-to-end and shows the confirmation", async ({ page }) => {
  await page.goto("/fr/doctors/amira-ben-salah");

  await page.getByLabel("Date").fill(nextWeekdayIsoDate(7));

  const firstSlot = page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first();
  await expect(firstSlot).toBeVisible();
  const slotLabel = await firstSlot.textContent();
  await firstSlot.click();

  await page.getByLabel("Nom complet").fill("Youssef Kacem");
  await page.getByLabel("Téléphone").fill("+216 98 765 432");
  await page.getByLabel("E-mail").fill("youssef.kacem@example.test");
  await page.getByRole("button", { name: "Confirmer le rendez-vous" }).click();

  await expect(page.getByText("Rendez-vous confirmé")).toBeVisible();
  await expect(page.getByText("Youssef Kacem")).toBeVisible();
  // "Clinique El Manar" alone also matches the always-visible sidebar
  // clinic card below — match the fuller confirmation-only string instead.
  await expect(page.getByText("Clinique El Manar — 12 Avenue Habib Bourguiba")).toBeVisible();
  if (slotLabel) {
    await expect(page.getByText(slotLabel, { exact: false })).toBeVisible();
  }

  // Fragment-URL management link (PROJECT_SPEC.md "Booking flow (M4)") —
  // never a path segment or query param.
  const managementLink = page.locator('a[href*="/fr/manage#token="]');
  await expect(managementLink).toBeVisible();
  const href = await managementLink.getAttribute("href");
  expect(href).toMatch(/\/fr\/manage#token=[0-9a-f]{64}$/);
});
