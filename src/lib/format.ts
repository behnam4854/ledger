// Display formatting helpers (client-side only — purely cosmetic).

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function fmtSignedUsd(n: number): string {
  return n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
}

export function fmtQty(value: string | number): string {
  return Number(value).toFixed(6);
}

export function fmtSignedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
