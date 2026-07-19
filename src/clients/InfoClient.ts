import { HttpClient } from '../core/HttpClient.js';
import { DEFAULT_BASE_URL } from '../utils/constants.js';
import type { ClientOptions, SystemConfig, Eip712Domain } from '../types/config.js';
import type { Market, Orderbook, Trade, Candle, CandleResolution, FundingRate } from '../types/market.js';
import type { Balance, Position, FundingPayment, Transfer, RealizedPnl } from '../types/account.js';
import type { OpenOrder, OrderHistoryEntry, Fill, TpslOrder } from '../types/order.js';
import type { SessionKeyStatus, SignerInfo, NonceState } from '../types/auth.js';

// Bar duration in nanoseconds for each natively-served resolution.
const CANDLE_INTERVAL_NS: Record<string, string> = {
  '1': '60000000000',
  '5': '300000000000',
  '15': '900000000000',
  '60': '3600000000000',
  '1D': '86400000000000',
  '1W': '604800000000000',
};

// Resolutions the API does not serve natively: fetch a base interval and
// aggregate client-side (matches the production RISEx datafeed).
const CANDLE_BASE_RESOLUTION: Record<string, string> = { '30': '15', '2H': '60', '4H': '60', '8H': '60' };
const CANDLE_AGGREGATION_FACTOR: Record<string, number> = { '30': 2, '2H': 2, '4H': 4, '8H': 8 };

/** Combine consecutive candles into groups of `factor` (open=first, close=last, high=max, low=min, volume=sum). */
/**
 * Aggregate base candles into `targetNs`-sized bars, grouped by EPOCH-ALIGNED
 * time bucket (not array index), so output bars land on standard boundaries
 * regardless of where the fetch window starts. Each candle's `time` is the
 * bucket's open boundary; open=first, close=last, high=max, low=min, volume=sum.
 */
function aggregateCandles(candles: Candle[], targetNs: bigint): Candle[] {
  const buckets = new Map<bigint, Candle[]>();
  for (const c of candles) {
    const key = BigInt(c.time) - (BigInt(c.time) % targetNs);
    const group = buckets.get(key);
    if (group) group.push(c);
    else buckets.set(key, [c]);
  }
  return [...buckets.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => {
      const group = buckets.get(key)!; // candles arrive in ascending time order
      const first = group[0];
      const last = group[group.length - 1];
      return {
        ...first,
        time: key.toString(),
        open: first.open,
        high: String(Math.max(...group.map((c) => parseFloat(c.high)))),
        low: String(Math.min(...group.map((c) => parseFloat(c.low)))),
        close: last.close,
        volume: String(group.reduce((sum, c) => sum + parseFloat(c.volume), 0)),
      };
    });
}

export class InfoClient {
  protected readonly http: HttpClient;

  constructor(opts?: ClientOptions) {
    this.http = new HttpClient({
      baseUrl: opts?.baseUrl ?? DEFAULT_BASE_URL,
      timeout: opts?.timeout,
      logLevel: opts?.logLevel,
    });
  }

  // ── System ──────────────────────────────────────────────

  async getSystemConfig(): Promise<SystemConfig> {
    return this.http.get<SystemConfig>('/v1/system/config');
  }

  async getEip712Domain(): Promise<Eip712Domain> {
    const raw = await this.http.get<Record<string, unknown>>('/v1/auth/eip712-domain');
    return {
      name: raw.name as string,
      version: raw.version as string,
      chainId: BigInt(raw.chain_id as string | number),
      verifyingContract: raw.verifying_contract as string,
    };
  }

  async getNonceState(account: string): Promise<NonceState> {
    return this.http.get<NonceState>(`/v1/nonce-state/${account}`);
  }

  // ── Markets ─────────────────────────────────────────────

  async getMarkets(): Promise<Market[]> {
    const data = await this.http.get<{ markets: Market[] }>('/v1/markets');
    return data.markets ?? [];
  }

  async getOrderbook(marketId: number, limit = 20): Promise<Orderbook> {
    return this.http.get<Orderbook>(`/v1/orderbook?market_id=${marketId}&limit=${limit}`);
  }

  async getTradeHistory(marketId: number, limit = 50): Promise<Trade[]> {
    const data = await this.http.get<{ trades: Trade[] }>(
      `/v1/trade-history?market_id=${marketId}&limit=${limit}`,
    );
    return data.trades ?? (data as unknown as Trade[]);
  }

  /**
   * Fetch OHLCV candles. `resolution` is a TradingView-style code; `from`/`to`
   * are unix-second bounds (optional). `1, 5, 15, 60, 1D, 1W` are served
   * natively; `30, 2H, 4H, 8H` are aggregated client-side from a base interval,
   * matching the production RISEx app.
   *
   * Note: the API expects `interval` as a nanosecond bar-duration (not a
   * `resolution` string), and `from`/`to` as unix nanoseconds — this method
   * handles that conversion.
   */
  async getCandles(
    marketId: number,
    resolution: CandleResolution,
    from?: number,
    to?: number,
  ): Promise<Candle[]> {
    const factor = CANDLE_AGGREGATION_FACTOR[resolution] ?? 1;
    const baseResolution = CANDLE_BASE_RESOLUTION[resolution] ?? resolution;
    const intervalNs = CANDLE_INTERVAL_NS[baseResolution];
    if (!intervalNs) throw new Error(`Unsupported candle resolution: ${resolution}`);

    let path = `/v1/trading-view-data?market_id=${marketId}&interval=${intervalNs}`;
    if (from !== undefined) path += `&from=${from}000000000`; // seconds → nanoseconds
    if (to !== undefined) path += `&to=${to}000000000`;
    const data = await this.http.get<{ data?: Candle[] }>(path);
    const candles = data.data ?? (data as unknown as Candle[]);
    if (factor <= 1) return candles;
    const targetNs = BigInt(intervalNs) * BigInt(factor); // epoch-aligned bucket size
    return aggregateCandles(candles, targetNs);
  }

  async getFundingRateHistory(marketId: number, limit = 50): Promise<FundingRate[]> {
    const data = await this.http.get<{ rates?: FundingRate[] }>(
      `/v1/markets/funding-rate-history?market_id=${marketId}&limit=${limit}`,
    );
    return data.rates ?? (data as unknown as FundingRate[]);
  }

  // ── Account (public read) ──────────────────────────────

  async getBalance(account: string): Promise<string> {
    const data = await this.http.get<Balance>(`/v1/account/cross-margin-balance?account=${account}`);
    return data.balance;
  }

  async getPosition(marketId: number, account: string): Promise<Position | null> {
    const data = await this.http.get<{ position: Position }>(
      `/v1/account/position?market_id=${marketId}&account=${account}`,
    );
    return data.position ?? null;
  }

  async getAllPositions(account: string): Promise<Position[]> {
    const data = await this.http.get<{ positions: Position[] }>(
      `/v1/positions?account=${account}`,
    );
    return data.positions ?? [];
  }

  async getOpenOrders(account: string, marketId?: number): Promise<OpenOrder[]> {
    let path = `/v1/orders/open?account=${account}`;
    if (marketId !== undefined) path += `&market_id=${marketId}`;
    const data = await this.http.get<{ orders: OpenOrder[] }>(path);
    return data.orders ?? [];
  }

  async getOpenTpslOrders(account: string): Promise<TpslOrder[]> {
    const data = await this.http.get<{ orders: TpslOrder[] }>(
      `/v1/orders/tpsl?account=${account}&statuses=TPSL_ORDER_STATUS_ACCEPTED`
    );
    return data.orders ?? [];
  }

  async getOrderHistory(account: string, marketId?: number, limit = 50): Promise<OrderHistoryEntry[]> {
    let path = `/v1/orders?account=${account}&limit=${limit}`;
    if (marketId !== undefined) path += `&market_id=${marketId}`;
    const data = await this.http.get<{ orders: OrderHistoryEntry[] }>(path);
    return data.orders ?? [];
  }

  async getAccountTradeHistory(account: string, marketId?: number, limit = 50): Promise<Fill[]> {
    let path = `/v1/trade-history?account=${account}&limit=${limit}`;
    if (marketId !== undefined) path += `&market_id=${marketId}`;
    const data = await this.http.get<{ fills?: Fill[]; trades?: Fill[] }>(path);
    return data.fills ?? data.trades ?? [];
  }

  async getFundingPaymentHistory(account: string, limit = 50): Promise<FundingPayment[]> {
    const data = await this.http.get<{ payments: FundingPayment[] }>(
      `/v1/account/funding-payments?account=${account}&limit=${limit}`,
    );
    return data.payments ?? [];
  }

  async getTransferHistory(account: string, limit = 50): Promise<Transfer[]> {
    const data = await this.http.get<{ transfers: Transfer[] }>(
      `/v1/account/transfer-history?account=${account}&limit=${limit}`,
    );
    return data.transfers ?? [];
  }

  async getRealizedPnl(account: string): Promise<RealizedPnl> {
    return this.http.get<RealizedPnl>(`/v1/account/realized-pnl?account=${account}`);
  }

  // ── Auth (read) ─────────────────────────────────────────

  async getSessionKeyStatus(account: string, signer: string): Promise<SessionKeyStatus> {
    return this.http.get<SessionKeyStatus>(
      `/v1/auth/session-key-status?account=${account}&signer=${signer}`,
    );
  }

  async listSigners(account: string): Promise<SignerInfo[]> {
    const data = await this.http.get<{ signers: SignerInfo[] }>(
      `/v1/auth/signers?account=${account}`,
    );
    return data.signers ?? [];
  }
}
