import { expect, test } from "@playwright/test";
import { login, logout, register, uniqueEmail } from "./helpers";

test("registers, automatically signs in, logs out, and signs in again", async ({ page }) => {
  const email = uniqueEmail("auth");
  const password = "TestPass123!";

  await register(page, email, password);
  await logout(page);
  await login(page, email, password);
});

test("shows useful registration and login errors", async ({ page }) => {
  await page.goto("/auth");
  await page.getByTestId("auth-register-tab").click();
  await page.getByTestId("auth-email").fill(uniqueEmail("mismatch"));
  await page.getByTestId("auth-password").fill("TestPass123!");
  await page.getByTestId("auth-confirm-password").fill("DifferentPass123!");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-error")).toHaveText("Passwords do not match.");

  await page.getByTestId("auth-login-tab").click();
  await page.getByTestId("auth-email").fill(uniqueEmail("missing"));
  await page.getByTestId("auth-password").fill("WrongPass123!");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-error")).toHaveText("Invalid email or password.");
});
