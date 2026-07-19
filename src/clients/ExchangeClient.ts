import { ethers } from 'ethers';
import { InfoClient } from './InfoClient.js';
import { createPermitParams, hexToBase64 } from '../signing/permit.js';
import { createRegisterSignerSignatures } from '../signing/signer.js';
import { encodeOrder, encodeCancelOrder, encodeCancelAll, encodeLeverage, encodeMarginMode, encodeIsolatedMargin } from '../signing/encoder.js';
import { PERMIT_SINGLE_TYPES, PLACE_TPSL_TYPES, CANCEL_TPSL_TYPES } from '../signing/domain.js';
import { Side, OrderType, TimeInForce, StpMode, MarginMode } from '../types/common.js';
import type { ExchangeClientOptions, Eip712Domain } from '../types/config.js';
import type { OrderParams, CancelParams, OrderResponse, CancelResponse, CancelAllResponse, ApprovePermitSingleParams, PlaceTpslOrderParams, CancelTpslOrderParams } from '../types/order.js';
import type { PermitParams, NonceState, RegisterSignerResult } from '../types/auth.js';

export class ExchangeClient {
  public readonly info: InfoClient;

  private readonly accountWallet: ethers.Wallet | null;
  private readonly signerWallet: ethers.Wallet;
  private readonly isErc1271: boolean;
  private domain!: Eip712Domain;
  private target!: string;
  private initialized = false;

  public readonly account: string;
  public readonly signer: string;

  constructor(opts: ExchangeClientOptions) {
    if (!opts.account && !opts.accountKey) {
      throw new Error('Either account (address) or accountKey (private key) must be provided.');
    }

    this.info = new InfoClient(opts);
    this.signerWallet = new ethers.Wallet(opts.signerKey);
    this.signer = this.signerWallet.address;
    this.isErc1271 = opts.erc1271 ?? false;

    if (opts.accountKey) {
      this.accountWallet = new ethers.Wallet(opts.accountKey);
      this.account = this.accountWallet.address;
    } else {
      this.accountWallet = null;
      this.account = opts.account!;
    }
  }

  /**
   * Initialize the client by fetching the EIP-712 domain and contract addresses.
   * Must be called before any authenticated operations.
   */
  async init(): Promise<this> {
    this.domain = await this.info.getEip712Domain();

    const config = await this.info.getSystemConfig();
    this.target =
      config.addresses?.router as string ??
      config.addresses?.perp_v2?.orders_manager as string ??
      config.contract_addresses?.perps_manager as string;
    if (!this.target) throw new Error('Could not find router/orders_manager in system config');

    this.initialized = true;
    return this;
  }

  private assertInit(): void {
    if (!this.initialized) throw new Error('ExchangeClient not initialized. Call init() first.');
  }

  private assertAccountKey(): void {
    if (!this.accountWallet) {
      throw new Error(
        'accountKey is required for this operation. ' +
        'Provide accountKey in ExchangeClientOptions, or register your signer via the RISEx web app.',
      );
    }
  }

  /** Fetch current nonce state for this account. */
  async getNonceState(): Promise<NonceState> {
    return this.info.getNonceState(this.account);
  }

  // ── Auth ────────────────────────────────────────────────

  async isSignerRegistered(): Promise<boolean> {
    const res = await this.info.getSessionKeyStatus(this.account, this.signer);
    return res.status === 1;
  }

  /**
   * Register the signer key on-chain.
   * Requires accountKey — if your signer was created via the RISEx web app, this is not needed.
   */
  async registerSigner(label = 'risex-ts'): Promise<RegisterSignerResult> {
    this.assertInit();
    this.assertAccountKey();
    if (await this.isSignerRegistered()) return { alreadyActive: true };

    const nonceState = await this.getNonceState();

    const sigs = await createRegisterSignerSignatures(
      this.accountWallet!,
      this.signerWallet,
      this.domain,
      nonceState,
    );

    return this.info['http'].post<RegisterSignerResult>('/v1/auth/register-signer', {
      account: this.account,
      signer: this.signer,
      message: sigs.message,
      nonce_anchor: String(sigs.nonceAnchor),
      nonce_bitmap_index: sigs.nonceBitmapIndex,
      expiration: String(sigs.expiration),
      account_signature: sigs.accountSignature,
      signer_signature: sigs.signerSignature,
      label,
    });
  }

  /**
   * Revoke a signer key on-chain.
   * Requires accountKey.
   */
  async revokeSigner(signerAddress?: string): Promise<unknown> {
    this.assertInit();
    this.assertAccountKey();
    const nonceState = await this.getNonceState();
    const sigs = await createRegisterSignerSignatures(
      this.accountWallet!,
      this.signerWallet,
      this.domain,
      nonceState,
    );
    return this.info['http'].post('/v1/auth/revoke-signer', {
      account: this.account,
      signer: signerAddress ?? this.signer,
      nonce_anchor: String(sigs.nonceAnchor),
      nonce_bitmap_index: sigs.nonceBitmapIndex,
      account_signature: sigs.accountSignature,
      signer_signature: sigs.signerSignature,
    });
  }

  // ── TPSL Authentication ───────────────────────────────────

  /**
   * Approves a budget for the operator hub to execute TPSL orders on your behalf.
   */
  async approvePermitSingle(params: ApprovePermitSingleParams): Promise<unknown> {
    this.assertInit();
    this.assertAccountKey();
    
    const sysConfig = await this.info.getSystemConfig();
    const operatorHub = sysConfig.addresses?.operator_hub as string | undefined;
    if (!operatorHub) throw new Error('OperatorHub address not found in system config');

    const nonceState = params.nonce ?? await this.getNonceState();
    const budget = BigInt(Math.ceil(params.budgetUsd)) * 10n ** 18n; // WAD
    const allowanceExpiry = Math.floor(Date.now() / 1000) + (params.allowanceExpirySeconds ?? (30 * 24 * 3600 - 3600));
    const nonceBitmapIndex = nonceState.current_bitmap_index;

    const signatureHex = await this.accountWallet!.signTypedData(
      {
        name: this.domain.name,
        version: this.domain.version,
        chainId: this.domain.chainId,
        verifyingContract: this.domain.verifyingContract,
      },
      PERMIT_SINGLE_TYPES,
      {
        account: this.account,
        operator: operatorHub,
        budget,
        allowanceExpiry,
        nonceAnchor: Number(nonceState.nonce_anchor),
        nonceBitmap: nonceBitmapIndex,
      }
    );

    return this.info['http'].post('/v1/auth/approve-single', {
      account: this.account,
      operator: operatorHub,
      budget: budget.toString(),
      allowance_expiry: allowanceExpiry,
      nonce_anchor: nonceState.nonce_anchor,
      nonce_bitmap_index: nonceBitmapIndex,
      signature: hexToBase64(signatureHex),
    });
  }

  // ── Orders ──────────────────────────────────────────────

  private async createPermit(hash: string, nonce?: NonceState): Promise<PermitParams> {
    this.assertInit();
    const nonceState = nonce ?? await this.getNonceState();
    return createPermitParams(
      hash,
      this.signerWallet,
      this.account,
      this.target,
      this.domain,
      nonceState,
      undefined,
      this.isErc1271,
    );
  }

  async placeOrder(orderParams: OrderParams): Promise<OrderResponse> {
    const hash = encodeOrder(orderParams, this.isErc1271);
    const permit = await this.createPermit(hash, orderParams.nonce);

    return this.info['http'].post<OrderResponse>('/v1/orders/place', {
      market_id: orderParams.market_id,
      side: orderParams.side,
      order_type: orderParams.order_type,
      price_ticks: orderParams.price_ticks,
      size_steps: orderParams.size_steps,
      time_in_force: orderParams.time_in_force,
      post_only: orderParams.post_only,
      reduce_only: orderParams.reduce_only,
      stp_mode: orderParams.stp_mode,
      ttl_units: orderParams.ttl_units,
      client_order_id: orderParams.client_order_id ?? '0',
      builder_id: orderParams.builder_id ?? 0,
      permit,
    });
  }

  async cancelOrder(params: CancelParams): Promise<CancelResponse> {
    let restingOrderId = params.resting_order_id;

    if (restingOrderId == null) {
      const openOrders = await this.info.getOpenOrders(this.account, params.market_id);
      const match = openOrders.find((o) => o.order_id === params.order_id);
      if (!match?.resting_order_id) {
        throw new Error(`Could not find resting_order_id for order ${params.order_id}. Pass it explicitly or ensure the order is still open.`);
      }
      restingOrderId = match.resting_order_id;
    }

    const hash = encodeCancelOrder({ ...params, resting_order_id: restingOrderId });
    const permit = await this.createPermit(hash, params.nonce);

    return this.info['http'].post<CancelResponse>('/v1/orders/cancel', {
      market_id: params.market_id,
      order_id: params.order_id,
      permit,
    });
  }

  async cancelAllOrders(marketId = 0, nonce?: NonceState): Promise<CancelAllResponse> {
    const hash = encodeCancelAll(marketId);
    const permit = await this.createPermit(hash, nonce);

    return this.info['http'].post<CancelAllResponse>('/v1/orders/cancel-all', {
      market_id: marketId,
      permit,
    });
  }

  // ── TPSL Orders ─────────────────────────────────────────

  async placeTpslOrder(params: PlaceTpslOrderParams): Promise<OrderResponse> {
    this.assertInit();
    const deadline = Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 3600);
    
    const message = {
      account: this.account,
      marketId: params.market_id,
      side: params.side === 'BUY' ? 0 : 1,
      size: params.size,
      stopType: params.stop_type === 'TAKE_PROFIT' ? 0 : 1,
      stopPrice: params.stop_price,
      limitPrice: params.limit_price,
      orderType: params.order_type,
      stopPriceOption: params.stop_price_option,
      tif: params.tif === 'GTC' ? 0 : 1, // fallback mapping
      deadline,
    };

    const signatureHex = await this.signerWallet.signTypedData(
      {
        name: this.domain.name,
        version: this.domain.version,
        chainId: this.domain.chainId,
        verifyingContract: this.domain.verifyingContract,
      },
      PLACE_TPSL_TYPES,
      message
    );

    return this.info['http'].post<OrderResponse>('/v1/orders/tpsl', {
      account: this.account,
      market_id: String(params.market_id),
      side: params.side,
      size: params.size,
      stop_type: params.stop_type,
      order_type: params.order_type,
      stop_price: params.stop_price,
      limit_price: params.limit_price,
      stop_price_option: params.stop_price_option,
      tif: params.tif,
      signer: this.signer,
      signature: hexToBase64(signatureHex),
      deadline,
    });
  }

  async cancelTpslOrder(params: CancelTpslOrderParams): Promise<CancelResponse> {
    this.assertInit();
    const deadline = Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 3600);

    const message = {
      account: this.account,
      orderId: params.order_id,
      deadline
    };

    const signatureHex = await this.signerWallet.signTypedData(
      {
        name: this.domain.name,
        version: this.domain.version,
        chainId: this.domain.chainId,
        verifyingContract: this.domain.verifyingContract,
      },
      CANCEL_TPSL_TYPES,
      message
    );

    return this.info['http'].post<CancelResponse>('/v1/orders/tpsl/cancel', {
      order_id: params.order_id,
      account: this.account,
      signer: this.signer,
      signature: hexToBase64(signatureHex),
      deadline
    });
  }

  // ── Convenience order methods ───────────────────────────

  async marketBuy(marketId: number, sizeSteps: number): Promise<OrderResponse> {
    return this.placeOrder({
      market_id: marketId,
      size_steps: sizeSteps,
      price_ticks: 0,
      side: Side.Long,
      order_type: OrderType.Market,
      time_in_force: TimeInForce.ImmediateOrCancel,
      post_only: false,
      reduce_only: false,
      stp_mode: StpMode.ExpireMaker,
      ttl_units: 0,
    });
  }

  async marketSell(marketId: number, sizeSteps: number, reduceOnly = false): Promise<OrderResponse> {
    return this.placeOrder({
      market_id: marketId,
      size_steps: sizeSteps,
      price_ticks: 0,
      side: Side.Short,
      order_type: OrderType.Market,
      time_in_force: TimeInForce.ImmediateOrCancel,
      post_only: false,
      reduce_only: reduceOnly,
      stp_mode: StpMode.ExpireMaker,
      ttl_units: 0,
    });
  }

  async limitBuy(
    marketId: number,
    sizeSteps: number,
    priceTicks: number,
    postOnly = false,
  ): Promise<OrderResponse> {
    return this.placeOrder({
      market_id: marketId,
      size_steps: sizeSteps,
      price_ticks: priceTicks,
      side: Side.Long,
      order_type: OrderType.Limit,
      time_in_force: TimeInForce.GoodTillCancelled,
      post_only: postOnly,
      reduce_only: false,
      stp_mode: StpMode.ExpireMaker,
      ttl_units: 0,
    });
  }

  async limitSell(
    marketId: number,
    sizeSteps: number,
    priceTicks: number,
    postOnly = false,
  ): Promise<OrderResponse> {
    return this.placeOrder({
      market_id: marketId,
      size_steps: sizeSteps,
      price_ticks: priceTicks,
      side: Side.Short,
      order_type: OrderType.Limit,
      time_in_force: TimeInForce.GoodTillCancelled,
      post_only: postOnly,
      reduce_only: false,
      stp_mode: StpMode.ExpireMaker,
      ttl_units: 0,
    });
  }

  async closePosition(marketId: number): Promise<OrderResponse | null> {
    const pos = await this.info.getPosition(marketId, this.account);
    if (!pos || pos.size === '0') return null;

    const absSize = parseFloat(pos.size) < 0 ? -parseFloat(pos.size) : parseFloat(pos.size);
    const markets = await this.info.getMarkets();
    const market = markets.find((m) => String(m.market_id) === String(marketId));
    const stepSize = market ? parseFloat(market.config.step_size) : 0.000001;
    const sizeSteps = Math.round(absSize / stepSize);

    const isLong = pos.side === 0;
    return isLong
      ? this.marketSell(marketId, sizeSteps, true)
      : this.marketBuy(marketId, sizeSteps);
  }

  // ── Account management ─────────────────────────────────

  async deposit(amount: string): Promise<unknown> {
    return this.info['http'].post('/v1/account/deposit', {
      account: this.account,
      amount,
    });
  }

  async updateLeverage(marketId: number, leverage: bigint, nonce?: NonceState): Promise<unknown> {
    const hash = encodeLeverage(marketId, leverage);
    const permit = await this.createPermit(hash, nonce);

    return this.info['http'].post('/v1/account/leverage', {
      market_id: marketId,
      leverage: String(leverage),
      permit,
    });
  }

  async updateMarginMode(marketId: number, mode: MarginMode, nonce?: NonceState): Promise<unknown> {
    const hash = encodeMarginMode(marketId, mode);
    const permit = await this.createPermit(hash, nonce);

    return this.info['http'].post('/v1/account/margin-mode', {
      market_id: marketId,
      margin_mode: mode,
      permit,
    });
  }

  async updateIsolatedMargin(marketId: number, amount: bigint, nonce?: NonceState): Promise<unknown> {
    const hash = encodeIsolatedMargin(marketId, amount);
    const permit = await this.createPermit(hash, nonce);

    return this.info['http'].post('/v1/account/isolated-margin', {
      market_id: marketId,
      amount: String(amount),
      permit,
    });
  }
}
