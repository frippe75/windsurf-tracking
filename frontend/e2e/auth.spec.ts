import { test, expect, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL || "e2e-test@tclab.org";
const PASSWORD = process.env.E2E_PASSWORD;

// The suite is safe to run anywhere: without a password it self-skips rather than
// failing. In CI, set E2E_PASSWORD (the dedicated e2e user).
test.skip(!PASSWORD, "set E2E_PASSWORD to run browser e2e");

async function login(page: Page) {
  await page.goto("/login");
  await expect(page.locator("#email")).toBeVisible();
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD!);
  await page.locator('button[type="submit"]').click();
}

test("login lands in the app and stores a token", async ({ page }) => {
  await login(page);

  // Redirected to the app; the login form is gone.
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect(page.locator("#email")).toHaveCount(0);

  // The auth token is persisted (what the API client attaches).
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  expect(token).toBeTruthy();
});

test("the protected route redirects an unauthenticated visitor to /login", async ({ page }) => {
  await page.goto("/");
  // Either lands on /login or shows the login form (depending on auth-required config).
  await page.waitForLoadState("networkidle");
  const onLogin = page.url().includes("/login") || (await page.locator("#email").count()) > 0;
  expect(onLogin).toBeTruthy();
});
