import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, register, uniqueEmail } from "./helpers";

test("portfolio and futures workspaces do not overflow common phone viewports", async ({ page }) => {
  await register(page, uniqueEmail("mobile"));

  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByTestId("unified-dashboard")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goto("/futures");
    await expect(page.locator(".futures-risk-panel")).toBeHidden();
    await expectNoHorizontalOverflow(page);
  }
});
