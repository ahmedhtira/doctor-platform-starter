import { test, expect, type Page } from "@playwright/test";

// Requires the local Supabase stack running and seeded
// (npm run db:start && npm run db:reset && npm run db:seed), same as
// booking.spec.ts. Runs against the production build (see
// playwright.config.ts's webServer), which matters for the privacy-header
// and Secure-cookie assertions below — dev mode serves different
// Cache-Control defaults for unrelated reasons (see PROJECT_SPEC.md
// "Patient self-service (M5)").

// Tests below run in parallel (playwright.config.ts's `fullyParallel`)
// against the same persistent local Supabase instance, and each books its
// own appointment on its own day offset to avoid colliding on the same
// slot. Offsets are spaced 3 apart specifically: nextWeekdayIsoDate's
// weekend-skip can shift a given offset forward by at most 2 days, so a
// gap of 3 guarantees two different offsets can never resolve to the same
// calendar date regardless of where the weekend falls.
function nextWeekdayIsoDate(daysOut: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysOut);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

// Books an appointment through the real UI and returns the fragment-URL
// management link from the confirmation screen — the only place a raw
// token is ever available outside trusted server memory.
async function bookAppointment(page: Page, patientName: string, daysOut: number): Promise<string> {
  await page.goto("/fr/doctors/amira-ben-salah");
  await page.getByLabel("Date").fill(nextWeekdayIsoDate(daysOut));

  const firstSlot = page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  await page.getByLabel("Nom complet").fill(patientName);
  await page.getByLabel("Téléphone").fill("+216 98 000 000");
  await page
    .getByLabel("E-mail")
    .fill(`${patientName.toLowerCase().replace(/\s+/g, ".")}@example.test`);
  await page.getByRole("button", { name: "Confirmer le rendez-vous" }).click();

  const managementLink = page.locator('a[href*="/fr/manage#token="]');
  await expect(managementLink).toBeVisible();
  const href = await managementLink.getAttribute("href");
  expect(href).toMatch(/\/fr\/manage#token=[0-9a-f]{64}$/);
  return href!;
}

test("redeems a management link, survives reload, and carries the required privacy headers", async ({
  page,
}) => {
  const href = await bookAppointment(page, "Manage E2E Patient", 30);

  const response = await page.goto(href);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");

  await expect(page.getByText("Gérer mon rendez-vous")).toBeVisible();
  await expect(page.getByText("Confirmé")).toBeVisible();

  // Reload without the fragment — proves the cookie-backed session is what
  // renders this, not a second (impossible, single-use) token redemption.
  await page.reload();
  await expect(page.getByText("Confirmé")).toBeVisible();

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "manage_session");
  expect(sessionCookie).toBeDefined();
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Strict");
  expect(sessionCookie?.path).toBe("/");
  expect(sessionCookie?.secure).toBe(true);
});

test("cancels an appointment through the confirm step", async ({ page }) => {
  const href = await bookAppointment(page, "Cancel E2E Patient", 33);
  await page.goto(href);

  await page.getByRole("button", { name: "Annuler le rendez-vous" }).click();
  await expect(page.getByText("Voulez-vous vraiment annuler ce rendez-vous ?")).toBeVisible();
  await page.getByRole("button", { name: "Oui, annuler" }).click();

  await expect(page.getByText("Annulé")).toBeVisible();
  await expect(page.getByRole("button", { name: "Modifier le rendez-vous" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Annuler le rendez-vous" })).toHaveCount(0);
});

test("reschedules an appointment, rotates the management link, burns the old one", async ({
  page,
  browser,
}) => {
  const href = await bookAppointment(page, "Reschedule E2E Patient", 36);
  await page.goto(href);

  await page.getByRole("button", { name: "Modifier le rendez-vous" }).click();
  await page.getByLabel("Date").fill(nextWeekdayIsoDate(39));
  const newSlot = page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first();
  await expect(newSlot).toBeVisible();
  await newSlot.click();
  await page.getByRole("button", { name: "Confirmer le nouveau créneau" }).click();

  await expect(page.getByText("Rendez-vous modifié")).toBeVisible();
  const newLink = page.locator('a[href*="/fr/manage#token="]');
  await expect(newLink).toBeVisible();
  const newHref = await newLink.getAttribute("href");
  expect(newHref).toMatch(/\/fr\/manage#token=[0-9a-f]{64}$/);
  expect(newHref).not.toBe(href);

  // "back to appointment" must actually leave the confirmation screen, not
  // get stuck showing it (regression check for the mode/phase not
  // resetting after router.refresh()).
  await page.getByRole("button", { name: "Retour au rendez-vous" }).click();
  await expect(page.getByRole("button", { name: "Modifier le rendez-vous" })).toBeVisible();

  // Old link, fresh browser context (no cookie) — must fail cleanly, not
  // silently show someone's appointment or crash.
  const staleContext = await browser.newContext();
  const stalePage = await staleContext.newPage();
  await stalePage.goto(href);
  await expect(stalePage.getByText("Lien invalide")).toBeVisible();
  await staleContext.close();

  // New link, another fresh context — must work.
  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage();
  await freshPage.goto(newHref!);
  await expect(freshPage.getByText("Gérer mon rendez-vous")).toBeVisible();
  await expect(freshPage.getByText("Confirmé")).toBeVisible();
  await freshContext.close();
});

test("a tampered cookie value is rejected, not shown as a valid appointment", async ({ page }) => {
  const href = await bookAppointment(page, "Tamper E2E Patient", 42);
  await page.goto(href);
  await expect(page.getByText("Confirmé")).toBeVisible();

  await page.context().addCookies([
    {
      name: "manage_session",
      value: "0".repeat(64),
      domain: "localhost",
      path: "/",
      httpOnly: true,
    },
  ]);
  await page.reload();
  await expect(page.getByText("Lien invalide")).toBeVisible();
});

test("switching locale mid-session keeps the session (site-wide cookie path)", async ({ page }) => {
  const href = await bookAppointment(page, "Locale E2E Patient", 45);
  await page.goto(href);
  await expect(page.getByText("Confirmé")).toBeVisible();

  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar\/manage$/);
  await expect(page.getByText("مؤكد")).toBeVisible();
});

test("opening a second appointment's link in the same tab switches to that appointment", async ({
  page,
}) => {
  const hrefA = await bookAppointment(page, "Multi Session Patient A", 48);
  await page.goto(hrefA);
  await expect(page.getByText("Confirmé")).toBeVisible();

  const hrefB = await bookAppointment(page, "Multi Session Patient B", 51);
  await page.goto(hrefB);
  await expect(page.getByText("Multi Session Patient B")).toBeVisible();
});
