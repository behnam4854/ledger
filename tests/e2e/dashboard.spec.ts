import { expect, test } from "@playwright/test";
import { register, uniqueEmail } from "./helpers";

test("combines spot and futures equity, exposure, and history", async ({ page }) => {
  await register(page, uniqueEmail("dashboard"));
  const date = new Date().toISOString().slice(0, 10);
  const buy = await page.request.post("/api/buys", { data: {
    wallet: "Main", asset: "BTC", amount: "0.01", price: "40000", date,
  } });
  expect(buy.ok()).toBeTruthy();
  const future = await page.request.post("/api/futures/positions", { data: {
    asset: "BTC", side: "LONG", margin: "100", leverage: 2, entryPrice: "50000",
    stopLoss: "45000", takeProfit: "60000", riskPercent: "", feeRateBps: "5",
    fundingRate: "0.01", fundingIntervalHours: 8, maintenanceMarginRate: "0.5",
    autoCloseEnabled: false,
  } });
  expect(future.ok()).toBeTruthy();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const dashboard = page.getByTestId("unified-dashboard");
  await expect(dashboard).toBeVisible();
  await expect(dashboard).toContainText("COMBINED EQUITY");
  await expect(dashboard).toContainText("SPOT EQUITY");
  await expect(dashboard).toContainText("FUTURES EQUITY");
  await expect(dashboard).toContainText("BOUGHT BTC");
  await expect(dashboard).toContainText("POSITION OPENED");
  await expect(dashboard).toContainText(/SPOT \$[1-9]/);
  await expect(dashboard).toContainText(/LONG \$[1-9]/);
});
