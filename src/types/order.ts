import type { Side, OrderType, TimeInForce, StpMode } from './common.js';
import type { NonceState } from './auth.js';

export interface OrderParams {
  market_id: number;
  side: Side;
  order_type: OrderType;
  price_ticks: number;
  size_steps: number;
  time_in_force: TimeInForce;
  post_only: boolean;
  reduce_only: boolean;
  stp_mode: StpMode;
  ttl_units: number;
  client_order_id?: string;
  builder_id?: number;
  /** Override nonce state instead of fetching from the API. */
  nonce?: NonceState;
}

export interface CancelParams {
  market_id: number;
  order_id: string;
  /** The resting_order_id (uint64) used in the permit hash. Fetched automatically if omitted. */
  resting_order_id?: string | number;
  /** Override nonce state instead of fetching from the API. */
  nonce?: NonceState;
}

export interface TpSlParams {
  market_id: number;
  take_profit_price?: string;
  stop_loss_price?: string;
  take_profit_order_type?: OrderType;
  stop_loss_order_type?: OrderType;
  [key: string]: unknown;
}

export interface ApprovePermitSingleParams {
  budgetUsd: number;
  allowanceExpirySeconds?: number;
  nonce?: NonceState;
}

export interface PlaceTpslOrderParams {
  market_id: number;
  side: 'BUY' | 'SELL';
  size: string;
  stop_type: 'TAKE_PROFIT' | 'STOP_LOSS';
  order_type: number;
  stop_price: string;
  limit_price: string;
  stop_price_option: number;
  tif: string;
  nonce?: NonceState;
  deadlineSeconds?: number;
}

export interface CancelTpslOrderParams {
  order_id: string;
  nonce?: NonceState;
  deadlineSeconds?: number;
}

export interface TpslOrder {
  order_id: string;
  market_id: number;
  account: string;
  side: string;
  size: string;
  stop_type: string;
  stop_price: string;
  limit_price: string;
  status: string;
  [key: string]: unknown;
}

export interface OrderResponse {
  order_id: string;
  sc_order_id: string;
  tx_hash: string;
  [key: string]: unknown;
}

export interface CancelResponse {
  success: boolean;
  tx_hash: string;
  [key: string]: unknown;
}

export interface CancelAllResponse {
  success: boolean;
  tx_hash: string;
  block_number?: string;
  [key: string]: unknown;
}

export interface OpenOrder {
  order_id: string;
  wide_order_id?: string;
  resting_order_id?: string;
  account: string;
  market_id: number;
  side: number;
  order_type: number;
  price_ticks: number;
  size_steps: number;
  time_in_force: number;
  post_only: boolean;
  reduce_only: boolean;
  [key: string]: unknown;
}

export interface OrderHistoryEntry {
  order_id: string;
  wide_order_id?: string;
  resting_order_id?: string;
  market_id: string;
  side: number;
  size: string;
  price: string;
  filled_size?: string;
  order_type: number;
  status: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface Fill {
  fill_id?: string;
  order_id: string;
  market_id: string;
  side: number;
  size: string;
  price: string;
  fee?: string;
  timestamp: string;
  [key: string]: unknown;
}
