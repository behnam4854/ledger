// CSV parsing/serialization for the ledger import/export.
//
// Unlike the original naive split(','), this parser handles quoted fields that
// contain commas, escaped double-quotes ("") and surrounding whitespace.

import { completedFundingIntervals, futuresFee, futuresFunding, futuresMetrics } from "./futures";
import type { BuyWithRemaining, FuturesPosition, PriceMap, Sell } from "./types";
import type { ImportPayload } from "./api";

/** Parse a single CSV line into fields, honouring quotes. */
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

/** Parse exported-style CSV text into an import payload. */
export function parseCsv(text: string): ImportPayload {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { buys: [], sells: [] };

  const headers = parseLine(lines[0]);
  const idx = (name: string) => headers.indexOf(name);

  const iType = idx("Type");
  const iWallet = idx("Wallet");
  const iAsset = idx("Asset");
  const iAmount = idx("Amount");
  const iPrice = idx("Price USD");
  const iDate = idx("Date");
  const iPnl = idx("Realized P&L USD");

  const buys: ImportPayload["buys"] = [];
  const sells: ImportPayload["sells"] = [];

  for (let i = 1; i < lines.length; i++) {
    const v = parseLine(lines[i]);
    const type = (v[iType] ?? "").toUpperCase();

    if (type === "BUY") {
      buys.push({
        wallet: v[iWallet] || "Main",
        asset: (v[iAsset] || "BTC").toUpperCase(),
        amount: v[iAmount] ?? "",
        price: v[iPrice] ?? "",
        date: v[iDate] ?? "",
      });
    } else if (type === "SELL") {
      sells.push({
        asset: (v[iAsset] || "").toUpperCase(),
        amount: v[iAmount] ?? "",
        sellPrice: v[iPrice] ?? "",
        sellDate: v[iDate] ?? "",
        profit: v[iPnl] ?? "",
      });
    }
  }

  return { buys, sells };
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Serialize the current ledger to CSV text (sorted by date). */
export function toCsv(buys: BuyWithRemaining[], sells: Sell[]): string {
  const header = ["Date", "Type", "Wallet", "Asset", "Amount", "Price USD", "Total USD", "Realized P&L USD"];
  const rows: (string | number)[][] = [];

  for (const b of buys) {
    rows.push([b.date, "BUY", b.wallet, b.asset, b.amount, b.price, Number(b.amount) * Number(b.price), ""]);
  }
  for (const s of sells) {
    const buy = buys.find((b) => b.id === s.buyId);
    rows.push([
      s.sellDate,
      "SELL",
      buy?.wallet ?? "",
      buy?.asset ?? "",
      s.amount,
      s.sellPrice,
      Number(s.amount) * Number(s.sellPrice),
      s.profit,
    ]);
  }

  rows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));

  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Export the full futures journal, including current metrics for open trades. */
export function toFuturesCsv(positions: FuturesPosition[], prices: PriceMap): string {
  const header = [
    "Record Type",
    "Position ID",
    "Execution ID",
    "Close Quantity",
    "Status",
    "Asset",
    "Side",
    "Leverage",
    "Margin USD",
    "Notional USD",
    "Quantity",
    "Entry Price USD",
    "Mark Price USD",
    "Stop Loss USD",
    "Take Profit USD",
    "Risk Percent",
    "Planned Risk USD",
    "Fee Rate Bps",
    "Entry Fee USD",
    "Exit Fee USD",
    "Funding Rate Percent",
    "Funding Interval Hours",
    "Funding P&L USD",
    "Gross P&L USD",
    "Maintenance Margin Rate Percent",
    "Maintenance Margin USD",
    "Liquidation Price USD",
    "Exit Price USD",
    "Unrealized P&L USD",
    "Realized P&L USD",
    "ROE Percent",
    "Opened At",
    "Closed At",
    "Journal Setup",
    "Journal Tags",
    "Journal Notes",
    "Journal Screenshot",
    "Close Reason",
  ];

  const positionRows = positions.map((position): (string | number)[] => {
    const markPrice = position.status === "CLOSED"
      ? Number(position.exitPrice ?? position.entryPrice)
      : prices[position.asset] ?? Number(position.entryPrice);
    const metrics = futuresMetrics({
      side: position.side,
      entryPrice: position.entryPrice,
      markPrice,
      margin: position.margin,
      leverage: position.leverage,
      quantity: position.quantity,
      maintenanceMarginRatePercent: position.maintenanceMarginRate ?? "0.5",
      exitFeeRateBps: position.feeRateBps ?? "0",
    });
    const intervals = position.status === "OPEN"
      ? completedFundingIntervals(position.openedAt, Date.now(), position.fundingIntervalHours ?? 8)
      : 0;
    const fundingPnl = position.status === "OPEN"
      ? futuresFunding({
          notional: metrics.notional,
          ratePercent: position.fundingRate ?? "0",
          intervals,
          side: position.side,
        })
      : position.fundingPnl ?? "0";
    const exitFee = position.status === "OPEN"
      ? futuresFee(Number(position.quantity) * markPrice, position.feeRateBps ?? "0")
      : position.exitFee ?? "0";
    const netOpenPnl = position.status === "OPEN"
      ? Number(metrics.pnl) - Number(position.entryFee ?? 0) - Number(exitFee) + Number(fundingPnl)
      : "";
    return [
      "POSITION",
      position.id,
      "",
      "",
      position.status,
      position.asset,
      position.side,
      position.leverage,
      position.margin,
      metrics.notional,
      position.quantity,
      position.entryPrice,
      markPrice,
      position.stopLoss ?? "",
      position.takeProfit ?? "",
      position.riskPercent ?? "",
      position.plannedRisk ?? "",
      position.feeRateBps ?? "",
      position.entryFee ?? "",
      exitFee,
      position.fundingRate ?? "",
      position.fundingIntervalHours ?? "",
      fundingPnl,
      position.status === "OPEN" ? metrics.pnl : position.grossPnl ?? "",
      position.maintenanceMarginRate ?? "0.5",
      metrics.maintenanceMargin,
      metrics.liquidationPrice,
      position.exitPrice ?? "",
      netOpenPnl,
      position.realizedPnl ?? "",
      position.status === "OPEN" ? metrics.roe : "",
      position.openedAt,
      position.closedAt ?? "",
      position.journalSetup ?? "",
      position.journalTags ?? "",
      position.journalNotes ?? "",
      position.journalScreenshot ?? "",
      position.closeReason ?? "",
    ];
  });

  const executionRows = positions.flatMap((position) => position.executions.map((execution): (string | number)[] => [
    "EXECUTION",
    position.id,
    execution.id,
    execution.quantity,
    "CLOSE",
    position.asset,
    position.side,
    position.leverage,
    execution.allocatedMargin,
    Number(execution.quantity) * Number(position.entryPrice),
    execution.quantity,
    position.entryPrice,
    execution.exitPrice,
    position.stopLoss ?? "",
    position.takeProfit ?? "",
    position.riskPercent ?? "",
    "",
    position.feeRateBps ?? "",
    execution.entryFee,
    execution.exitFee,
    position.fundingRate ?? "",
    position.fundingIntervalHours ?? "",
    execution.fundingPnl,
    execution.grossPnl,
    position.maintenanceMarginRate ?? "0.5",
    "",
    "",
    execution.exitPrice,
    "",
    execution.realizedPnl,
    "",
    position.openedAt,
    execution.closedAt,
    position.journalSetup ?? "",
    position.journalTags ?? "",
    position.journalNotes ?? "",
    position.journalScreenshot ?? "",
    execution.reason,
  ]));
  const rows = [...positionRows, ...executionRows];

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
