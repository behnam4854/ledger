// CSV parsing/serialization for the ledger import/export.
//
// Unlike the original naive split(','), this parser handles quoted fields that
// contain commas, escaped double-quotes ("") and surrounding whitespace.

import type { BuyWithRemaining, Sell } from "./types";
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
