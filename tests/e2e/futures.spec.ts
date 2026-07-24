import { expect, test } from "@playwright/test";
import { register, uniqueEmail } from "./helpers";

test("opens, adjusts, partially closes, fully closes, edits, and deletes a futures trade", async ({ page }) => {
  await register(page, uniqueEmail("futures"));
  await page.goto("/futures");

  await expect(page.locator("#futuresAsset")).toHaveAttribute("type", "search");
  await expect(page.locator("#futuresAsset")).toHaveAttribute("list", "futuresCoinOptions");

  await page.locator("#futuresMargin").fill("200");
  await page.locator("#futuresEntryPrice").fill("50000");
  await page.locator("#futuresStopLoss").fill("45000");
  await page.locator("#futuresTakeProfit").fill("100000");
  await page.locator(".automation-order-toggle input").uncheck();
  await page.getByTestId("open-position").click();

  const openRow = page.locator('[data-testid^="open-position-"]');
  await expect(openRow).toHaveCount(1, { timeout: 20_000 });
  const positionTestId = await openRow.getAttribute("data-testid");
  expect(positionTestId).toBeTruthy();
  const positionId = positionTestId!.replace("open-position-", "");

  for (let index = 0; index < 6; index += 1) {
    const automation = await page.request.patch(`/api/futures/positions/${positionId}/automation`, { data: { enabled: index % 2 === 0 } });
    expect(automation.ok()).toBeTruthy();
  }

  await openRow.getByRole("button", { name: "ADJUST", exact: true }).click();
  await page.getByLabel("Adjusted stop-loss for BTC").fill("46000");
  await page.getByLabel("Adjusted take-profit for BTC").fill("61000");
  await page.getByLabel("Margin change for BTC").fill("25");
  await openRow.locator(".adjustment-save-button").click();
  await expect(page.getByTestId("action-feedback")).toContainText("risk controls updated");

  await page.getByLabel("Exit price for BTC").fill("51000");
  await page.getByTestId(`close-slider-${positionId}`).fill("50");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("close 50% of BTC LONG");
    await dialog.accept();
  });
  await openRow.locator(".close-position-button").click();
  await expect(page.getByTestId("action-feedback")).toContainText("Closed");
  await expect(page.locator(`[data-testid="open-position-${positionId}"]`)).toBeVisible();

  const remainingRow = page.locator(`[data-testid="open-position-${positionId}"]`);
  await remainingRow.getByLabel("Exit price for BTC").fill("52000");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("fully close BTC LONG");
    await dialog.accept();
  });
  await remainingRow.locator(".close-position-button").click();
  await expect(remainingRow).toHaveCount(0);

  const closedRow = page.locator(".futures-history tbody tr").filter({ hasText: "BTC/USD" });
  await expect(closedRow).toHaveCount(1);
  await closedRow.getByRole("button", { name: "EDIT", exact: true }).click();
  await page.getByTestId("closed-exit-price").fill("53000");
  await page.locator(".closed-editor-footer .btn-action").click();
  await expect(page.locator(".closed-trade-editor")).toHaveCount(0);
  await expect(closedRow).toContainText("$53000.00");

  page.once("dialog", async (dialog) => dialog.accept());
  await closedRow.getByRole("button", { name: "DELETE", exact: true }).click();
  await expect(page.locator(".futures-history tbody")).toContainText("Closed positions will appear here.");

  const activity = await page.request.get("/api/futures/activity");
  expect(activity.ok()).toBeTruthy();
  const payload = await activity.json() as { activities: { positionId: number; action: string }[] };
  const actions = payload.activities
    .filter((event) => event.positionId === Number(positionId))
    .map((event) => event.action);
  expect(actions).toEqual(expect.arrayContaining([
    "POSITION_OPENED",
    "POSITION_ADJUSTED",
    "POSITION_PARTIALLY_CLOSED",
    "POSITION_CLOSED",
    "CLOSED_TRADE_EDITED",
    "CLOSED_TRADE_DELETED",
  ]));
  const activityPanel = page.getByTestId("futures-activity");
  await expect(activityPanel).toContainText("CLOSED TRADE DELETED");
  await expect(activityPanel.locator("article")).toHaveCount(5);
  await expect(page.locator(".futures-journal + .futures-activity")).toHaveCount(1);
  await activityPanel.getByRole("button", { name: "VIEW FULL HISTORY", exact: true }).click();
  await expect(activityPanel.locator("article")).toHaveCount(10);
  await expect(activityPanel).toContainText("PAGE 1 / 2");
  await activityPanel.getByRole("button", { name: "NEXT", exact: true }).click();
  await expect(activityPanel).toContainText("PAGE 2 / 2");
  await expect(activityPanel.locator("article")).toHaveCount(2);
});
