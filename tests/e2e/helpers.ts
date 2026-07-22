import { expect, type Page } from "@playwright/test";

export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@tests.ledgrs.local`;
}

export async function register(page: Page, email: string, password = "TestPass123!") {
  await page.goto("/auth");
  await page.getByTestId("auth-register-tab").click();
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-confirm-password").fill(password);
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "LOGOUT", exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
}

export async function login(page: Page, email: string, password = "TestPass123!") {
  await page.goto("/auth");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `horizontal overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.clientWidth);
}
