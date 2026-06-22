export interface MarketConfig {
  min_order_size: string;
  step_size: string;
  step_price: string;
  max_leverage: string;
  [key: string]: unknown;
}

export interface Market {
  market_id: string;
  display_name: string;
  base_asset_symbol: string;
  quote_asset_symbol: string;
  last_price: string;
  mark_price: string;
  index_price: string;
  visible: boolean;
  post_only: boolean;
  config: MarketConfig;
  [key: string]: unknown;
}

export interface OrderbookLevel {
  price: string;
  quantity: string;
}

export interface Orderbook {
  market_id: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp?: string;
  checksum?: number;
}

export interface Trade {
  market_id: string;
  price: string;
  size: string;
  side: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface Candle {
  /** Bar open time as a unix-nanosecond string (the API field is `time`). */
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  [key: string]: unknown;
}

/**
 * Candle resolutions supported by `InfoClient.getCandles`, in TradingView style.
 * `1, 5, 15, 60, 1D, 1W` are served natively by the API; `30, 2H, 4H, 8H` are
 * aggregated client-side from a base interval (matching the production app).
 */
export type CandleResolution = '1' | '5' | '15' | '30' | '60' | '2H' | '4H' | '8H' | '1D' | '1W';

export interface FundingRate {
  market_id: string;
  funding_rate: string;
  timestamp: string;
  [key: string]: unknown;
}
