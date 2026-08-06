import { test, expect } from "@playwright/test";

test("home page redirects to the default locale and renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/fr(\/|$)/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});
