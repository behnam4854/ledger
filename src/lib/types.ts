// Shared types for the LEDGRS domain.
// All monetary / quantity values are decimal strings on the wire (see schema).

export type Asset = string;

export interface CoinDefinition {
  symbol: string;
  name: string;
  coingeckoId: string;
  builtIn: boolean;
}

export const CORE_COINS: CoinDefinition[] = [
  { symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", builtIn: true },
  { symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", builtIn: true },
  { symbol: "XAUT", name: "Tether Gold", coingeckoId: "tether-gold", builtIn: true },
];

/** Assets with historical candles and quant signals enabled by default. */
export const ASSETS: Asset[] = CORE_COINS.map((coin) => coin.symbol);

export const ASSET_TO_COINGECKO_ID: Record<string, string> = Object.fromEntries(
  CORE_COINS.map((coin) => [coin.symbol, coin.coingeckoId]),
);

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

export type PriceMap = Record<string, number>;

export interface Portfolio {
  buys: BuyWithRemaining[];
  sells: Sell[];
  usd: number;
}

export interface PricesResponse {
  prices: PriceMap;
  coins: CoinDefinition[];
  status: "live" | "stale";
  updatedAt: number | null;
}

/** One day of price history for an asset (decimal string close on the wire). */
export interface Candle {
  asset: string;
  date: string; // ISO date (YYYY-MM-DD)
  close: string; // decimal string — USD
}

export interface CandlesResponse {
  asset: Asset;
  candles: Candle[];
}

/** Current signal + latest indicator readings for one asset. */
export interface AssetSignal {
  asset: Asset;
  signal: "BUY" | "SELL" | "HOLD";
  reason: string;
  strength: number;
  rsi: number | null;
  smaShort: number | null;
  smaLong: number | null;
  lastClose: number | null;
  history: number; // number of daily closes available
}

export interface SignalsResponse {
  signals: AssetSignal[];
  generatedAt: number;
}

export type FuturesSide = "LONG" | "SHORT";

export interface FuturesPosition {
  id: number;
  asset: string;
  side: FuturesSide;
  leverage: number;
  margin: string;
  quantity: string;
  entryPrice: string;
  stopLoss: string | null;
  takeProfit: string | null;
  status: "OPEN" | "CLOSED";
  exitPrice: string | null;
  realizedPnl: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface FuturesAccountResponse {
  balance: number;
  positions: FuturesPosition[];
}
