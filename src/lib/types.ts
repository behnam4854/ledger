// Shared types for the LEDGRS domain.
// All monetary / quantity values are decimal strings on the wire (see schema).

export type Asset = "BTC" | "ETH" | "XAUT";

export const ASSETS: Asset[] = ["BTC", "ETH", "XAUT"];

export const ASSET_TO_COINGECKO_ID: Record<Asset, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  XAUT: "tether-gold",
};

export interface Buy {
  id: number;
  wallet: string;
  asset: string;
  amount: string;
  price: string;
  date: string;
}

export interface Sell {
  id: number;
  buyId: number;
  amount: string;
  sellPrice: string;
  sellDate: string;
  profit: string;
}

/** A buy enriched with its computed remaining (un-sold) quantity. */
export interface BuyWithRemaining extends Buy {
  remaining: string;
}

export type PriceMap = Record<Asset, number>;

export interface Portfolio {
  buys: BuyWithRemaining[];
  sells: Sell[];
  usd: number;
}

export interface PricesResponse {
  prices: PriceMap;
  status: "live" | "stale";
  updatedAt: number | null;
}
