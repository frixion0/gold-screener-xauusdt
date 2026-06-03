// Self-Scheduling Bot Engine
// RSI strategy: checks every 3 minutes (aligned to candle closes)
// CANDLE strategy: checks every 30 seconds (fast response to direction changes)
//
// KEY FIX: Interval ALWAYS starts regardless of first-check success/failure
// KEY FIX: Multiple Binance proxy fallbacks + client-side kline relay

import { db } from './db';
import { runStrategy, getCurrentState } from './rsi';

const BINANCE_FUTURES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const MUDREX_API = 'https://trade.mudrex.com/fapi/v1/futures';
const SECRET_KEY = 'v33dnrb92FKBSMTVUxJ6ufeW7cBBEmmK';
const SYMBOL = 'XAUUSDT';
const INTERVAL = '3m';
const LIMIT = 200;
const RSI_LENGTH = 1;
const SMA_LENGTH = 14;

// CANDLE strategy checks every 30 seconds for fast response
const CANDLE_CHECK_MS = 30 * 1000;
// RSI strategy checks every 3 minutes
const RSI_CHECK_MS = 3 * 60 * 1000;

// Multiple CORS proxy fallbacks for Binance on cloud hosts
const PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest=',
];

interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface EngineState {
  isRunning: boolean;
  startedAt: string | null;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  lastResult: string | null;
  lastTradeResult: string | null;
  checkCount: number;
  errorCount: number;
  autoTrade: boolean;
  lastDesiredAction: string | null;
  lastTradedCandleTime: number | null;
  currentIntervalMs: number;
  lastFetchError: string | null;
  relayFreshnessMs: number;
}

const engineState: EngineState = {
  isRunning: false,
  startedAt: null,
  lastCheckAt: null,
  nextCheckAt: null,
  lastResult: null,
  lastTradeResult: null,
  checkCount: 0,
  errorCount: 0,
  autoTrade: false,
  lastDesiredAction: null,
  lastTradedCandleTime: null,
  currentIntervalMs: RSI_CHECK_MS,
  lastFetchError: null,
  relayFreshnessMs: -1,
};

let intervalRef: ReturnType<typeof setInterval> | null = null;

// Relay cache: client-side POSTs klines here when server fetch fails
let relayCache: { candles: KlineData[]; updatedAt: number } | null = null;

/**
 * Store relay klines (called by /api/klines/relay when client sends data)
 */
export function storeRelayKlines(candles: KlineData[]): void {
  relayCache = { candles, updatedAt: Date.now() };
  console.log(`[Bot Engine] Relay cache updated with ${candles.length} candles from client`);
}

async function fetchKlinesDirect(url: string): Promise<KlineData[] | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const data = await response.json();
      return data.map((k: (string | number)[]) => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      }));
    }
  } catch (err) {
    console.error(`[Fetch] Direct failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  return null;
}

async function fetchKlines(): Promise<KlineData[]> {
  const url = `${BINANCE_FUTURES_URL}?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${LIMIT}`;

  // 1. Try direct fetch
  const direct = await fetchKlinesDirect(url);
  if (direct && direct.length > 0) {
    engineState.lastFetchError = null;
    return direct;
  }

  // 2. Try each CORS proxy in order
  for (const proxy of PROXIES) {
    const proxyUrl = `${proxy}${encodeURIComponent(url)}`;
    console.log(`[Fetch] Trying proxy: ${proxy.split('/')[2]}`);
    try {
      const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        try {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            const candles = data.map((k: (string | number)[]) => ({
              time: Math.floor(Number(k[0]) / 1000),
              open: parseFloat(String(k[1])),
              high: parseFloat(String(k[2])),
              low: parseFloat(String(k[3])),
              close: parseFloat(String(k[4])),
              volume: parseFloat(String(k[5])),
            }));
            engineState.lastFetchError = null;
            console.log(`[Fetch] Success via proxy ${proxy.split('/')[2]}: ${candles.length} candles`);
            return candles;
          }
        } catch {
          console.error(`[Fetch] Proxy ${proxy.split('/')[2]} returned invalid JSON`);
        }
      }
    } catch (err) {
      console.error(`[Fetch] Proxy ${proxy.split('/')[2]} failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  // 3. Fallback: use relay cache (client-side data)
  if (relayCache && relayCache.candles.length > 0) {
    const age = Date.now() - relayCache.updatedAt;
    engineState.relayFreshnessMs = age;
    console.log(`[Fetch] Using relay cache (${Math.round(age / 1000)}s old, ${relayCache.candles.length} candles)`);
    engineState.lastFetchError = `Using relay cache (${Math.round(age / 1000)}s old)`;
    return relayCache.candles;
  }

  const errMsg = 'All fetch methods failed (direct + 3 proxies + relay empty)';
  engineState.lastFetchError = errMsg;
  throw new Error(errMsg);
}

/**
 * Place an order via Mudrex API
 */
async function placeMudrexOrder(params: {
  order_type: 'LONG' | 'SHORT';
  order_price: number;
  quantity: number;
  leverage: number;
  stoploss_price?: number;
  takeprofit_price?: number;
}): Promise<{ success: boolean; order_id?: string; error?: string }> {
  if (!SECRET_KEY) return { success: false, error: 'Mudrex API key not configured' };

  const hasSL = params.stoploss_price !== undefined && params.stoploss_price > 0;
  const hasTP = params.takeprofit_price !== undefined && params.takeprofit_price > 0;

  const orderBody: Record<string, unknown> = {
    leverage: params.leverage,
    quantity: params.quantity,
    order_price: Math.round(params.order_price),
    order_type: params.order_type,
    trigger_type: 'MARKET',
    is_takeprofit: hasTP,
    is_stoploss: hasSL,
    reduce_only: false,
  };

  if (hasSL) orderBody.stoploss_price = Math.round(params.stoploss_price);
  if (hasTP) orderBody.takeprofit_price = Math.round(params.takeprofit_price);

  const url = `${MUDREX_API}/${SYMBOL}/order?is_symbol`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Authentication': SECRET_KEY,
      },
      body: JSON.stringify(orderBody),
    });

    const json = await res.json();

    if (json.success) {
      console.log(`[Mudrex] Auto-trade ${params.order_type} placed: order_id=${json.data?.order_id}`);
      return { success: true, order_id: json.data?.order_id };
    } else {
      const errMsg = json.message || `API error: ${res.status}`;
      console.error(`[Mudrex] Auto-trade ${params.order_type} failed: ${errMsg}`, json);
      return { success: false, error: errMsg };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Mudrex] Auto-trade ${params.order_type} error: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

/**
 * Close existing position via Mudrex dedicated close-by-position_id API
 * POST /futures/positions/{position_id}/close
 * This is the proper way — placing opposite orders causes Mudrex to just
 * close the existing position instead of opening a new one.
 */
async function closeMudrexPositionByPositionId(positionId: string): Promise<{ success: boolean; error?: string }> {
  if (!SECRET_KEY) return { success: false, error: 'Mudrex API key not configured' };

  const url = `${MUDREX_API}/positions/${positionId}/close`;

  try {
    console.log(`[Mudrex] Closing position_id=${positionId}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Authentication': SECRET_KEY,
      },
    });

    const json = await res.json();

    if (json.success) {
      console.log(`[Mudrex] Position closed: position_id=${json.data?.position_id}, status=${json.data?.status}`);
      return { success: true };
    } else {
      const errMsg = json.message || `Close API error: ${res.status}`;
      console.error(`[Mudrex] Close failed: ${errMsg}`, json);
      return { success: false, error: errMsg };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Mudrex] Close error: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

/**
 * Fetch open Mudrex positions and close any XAUUSDT position
 * Returns the closed position info or error
 */
async function closeMudrexPosition(): Promise<{ success: boolean; positionId?: string; orderType?: string; error?: string }> {
  if (!SECRET_KEY) return { success: false, error: 'Mudrex API key not configured' };

  // Step 1: Fetch open positions to find the position_id
  try {
    const posRes = await fetch(`${MUDREX_API}/positions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Authentication': SECRET_KEY,
      },
    });

    if (!posRes.ok) {
      return { success: false, error: `Fetch positions failed: ${posRes.status}` };
    }

    const posJson = await posRes.json();
    const positions: Array<{ id: string; symbol: string; order_type: string; status: string }> = posJson.data || [];

    // Find XAUUSDT open position
    const xauPosition = positions.find(
      (p) => p.symbol === SYMBOL && (p.status === 'OPEN' || p.status === 'ACTIVE')
    );

    if (!xauPosition) {
      console.log(`[Mudrex] No open XAUUSDT position found — already closed or none exists`);
      return { success: true, positionId: 'none' };
    }

    console.log(`[Mudrex] Found open position: id=${xauPosition.id}, type=${xauPosition.order_type}, status=${xauPosition.status}`);

    // Step 2: Close using dedicated position_id endpoint
    const closeResult = await closeMudrexPositionByPositionId(xauPosition.id);
    if (closeResult.success) {
      return { success: true, positionId: xauPosition.id, orderType: xauPosition.order_type };
    } else {
      return { success: false, error: closeResult.error };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Mudrex] Close position error: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

/**
 * Sync DB position with actual Mudrex position to handle manual closes.
 * This runs at the START of runBotCheck() before any strategy logic.
 */
async function syncPositionWithMudrex(): Promise<void> {
  try {
    const posRes = await fetch(`${MUDREX_API}/positions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Authentication': SECRET_KEY,
      },
    });

    if (!posRes.ok) {
      console.error(`[Position Sync] Failed to fetch Mudrex positions: ${posRes.status}`);
      return;
    }

    const posJson = await posRes.json();
    const positions: Array<{ id: string; symbol: string; order_type: string; status: string }> = posJson.data || [];

    const xauPosition = positions.find(
      (p) => p.symbol === SYMBOL && (p.status === 'OPEN' || p.status === 'ACTIVE')
    );

    const botConfig = await db.botState.findUnique({ where: { id: 1 } });
    const dbPosition = botConfig?.position || 'NEUTRAL';

    if (!xauPosition && dbPosition !== 'NEUTRAL') {
      // No XAUUSDT position on Mudrex but DB says LONG/SHORT → user closed manually
      console.log(`[Position Sync] Mudrex has NO position but DB says ${dbPosition} → resetting to NEUTRAL (user closed manually)`);
      await db.botState.upsert({
        where: { id: 1 },
        create: { position: 'NEUTRAL' },
        update: { position: 'NEUTRAL' },
      });
    } else if (xauPosition && dbPosition === 'NEUTRAL') {
      // Position exists on Mudrex but DB says NEUTRAL → sync to match actual
      const actualType = xauPosition.order_type.toUpperCase();
      console.log(`[Position Sync] Mudrex has ${actualType} but DB says NEUTRAL → updating DB to ${actualType}`);
      await db.botState.upsert({
        where: { id: 1 },
        create: { position: actualType },
        update: { position: actualType },
      });
    } else if (xauPosition && dbPosition !== 'NEUTRAL' && dbPosition !== xauPosition.order_type.toUpperCase()) {
      // Mismatched directions — sync to actual
      const actualType = xauPosition.order_type.toUpperCase();
      console.log(`[Position Sync] Mismatch! DB says ${dbPosition} but Mudrex has ${actualType} → updating DB to ${actualType}`);
      await db.botState.upsert({
        where: { id: 1 },
        create: { position: actualType },
        update: { position: actualType },
      });
    } else {
      // Both agree — no sync needed
      if (dbPosition === 'NEUTRAL') {
        console.log(`[Position Sync] DB=${dbPosition}, Mudrex=none → in sync ✓`);
      } else {
        console.log(`[Position Sync] DB=${dbPosition}, Mudrex=${xauPosition?.order_type || 'none'} → in sync ✓`);
      }
    }
  } catch (err) {
    console.error(`[Position Sync] Error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }
}

async function runBotCheck(): Promise<void> {
  if (engineState.isRunning) return;
  engineState.isRunning = true;

  try {
    // ========================================
    // STEP 0: Sync position with Mudrex BEFORE any strategy logic
    // ========================================
    await syncPositionWithMudrex();

    // Read config from DB — this is the SNAPSHOT after position sync
    const botConfig = await db.botState.findUnique({ where: { id: 1 } });
    engineState.autoTrade = botConfig?.autoTrade ?? false;
    const activeStrategy = botConfig?.strategy ?? 'RSI';
    const currentPos = botConfig?.position || 'NEUTRAL'; // Position BEFORE this check

    // Dynamically adjust interval based on strategy
    const newInterval = activeStrategy === 'CANDLE' ? CANDLE_CHECK_MS : RSI_CHECK_MS;
    if (newInterval !== engineState.currentIntervalMs) {
      engineState.currentIntervalMs = newInterval;
      // Restart interval with new timing
      if (intervalRef) {
        clearInterval(intervalRef);
        intervalRef = setInterval(() => {
          runBotCheck();
          engineState.nextCheckAt = new Date(Date.now() + engineState.currentIntervalMs).toISOString();
        }, engineState.currentIntervalMs);
        console.log(`[Bot Engine] Interval changed to ${engineState.currentIntervalMs / 1000}s for ${activeStrategy} strategy`);
      }
    }

    const candles = await fetchKlines();
    if (candles.length < 20) {
      throw new Error(`Not enough candles: ${candles.length}`);
    }

    // For CANDLE strategy: use the LAST COMPLETED candle for stable signals
    // For RSI strategy: use the last completed candle for accurate crossover detection
    const latestCandle = candles[candles.length - 1];
    const prevCandle = candles.length > 1 ? candles[candles.length - 2] : latestCandle;
    const currentPrice = latestCandle?.close ?? 0;

    // ========================================
    // STEP 1: Determine desired position from strategy
    // ========================================
    let desiredAction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    let signalPrice = currentPrice;
    let signalRSI = 0;
    let signalSMA = 0;
    let signalCandleTime = 0;
    let candleDirection = ''; // for logging

    if (activeStrategy === 'CANDLE') {
      // Strategy 2: Check the last completed candle (second to last = candles[n-2])
      // The last candle in Binance response is the currently forming one
      // We use the completed candle for a stable signal
      const targetCandle = candles.length >= 2 ? candles[candles.length - 2] : candles[candles.length - 1];

      if (targetCandle) {
        const isBullish = targetCandle.close > targetCandle.open;
        const spread = Math.abs(targetCandle.close - targetCandle.open);
        // For gold at $2300+, a spread < $0.50 is noise (0.02%)
        const isDoji = spread < 0.5;

        if (isDoji) {
          // Doji — no clear direction, hold current position
          desiredAction = currentPos as 'LONG' | 'SHORT' | 'NEUTRAL';
          candleDirection = `DOJI (spread=$${spread.toFixed(2)})`;
        } else {
          desiredAction = isBullish ? 'LONG' : 'SHORT';
          candleDirection = isBullish ? 'GREEN (close>open)' : 'RED (close<open)';
        }
        signalPrice = targetCandle.close;
        signalCandleTime = targetCandle.time;

        console.log(`[Bot Engine] CANDLE: ${candleDirection} | close=$${targetCandle.close.toFixed(2)} open=$${targetCandle.open.toFixed(2)} → desired=${desiredAction}`);
      }

      // Store signal in DB only once per completed candle (dedup by candleTime)
      if (signalCandleTime > 0 && signalCandleTime !== engineState.lastTradedCandleTime) {
        const existingSignal = await db.signal.findFirst({
          where: { candleTime: signalCandleTime, type: { startsWith: '[S2]' } },
        });
        if (!existingSignal && desiredAction !== 'NEUTRAL') {
          await db.signal.create({
            data: {
              type: `[S2] ${desiredAction === 'LONG' ? 'BUY' : 'SELL'}`,
              price: signalPrice,
              rsi: 0,
              rsiSma: 0,
              candleTime: signalCandleTime,
            },
          });
          console.log(`[Bot Engine] Stored CANDLE signal: ${desiredAction} @ $${signalPrice.toFixed(2)}`);
        }
      }

      // Update bot state — lastPing and strategy only, NOT position
      await db.botState.upsert({
        where: { id: 1 },
        create: {
          position: 'NEUTRAL',
          currentRSI: 0,
          currentSMA: 0,
          lastPing: new Date(),
          strategy: 'CANDLE',
        },
        update: {
          lastPing: new Date(),
          strategy: 'CANDLE',
          currentRSI: 0,
          currentSMA: 0,
        },
      });
    } else {
      // Strategy 1: RSI(1) + SMA(14)
      const { signals } = runStrategy(candles, RSI_LENGTH, SMA_LENGTH);
      const state = getCurrentState(candles, RSI_LENGTH, SMA_LENGTH);

      desiredAction = state.position === 'LONG' ? 'LONG' : 'NEUTRAL';
      signalRSI = state.currentRSI ?? 0;
      signalSMA = state.currentSMA ?? 0;

      console.log(`[Bot Engine] RSI: position=${state.position}, RSI=${signalRSI.toFixed(1)}, SMA=${signalSMA.toFixed(1)} → desired=${desiredAction}`);

      // Store RSI crossover signals in DB
      for (const signal of signals) {
        const exists = await db.signal.findFirst({
          where: { candleTime: signal.candleTime, type: signal.type },
        });
        if (!exists) {
          await db.signal.create({
            data: {
              type: signal.type,
              price: signal.price,
              rsi: signal.rsi,
              rsiSma: signal.rsiSma,
              candleTime: signal.candleTime,
            },
          });
        }
      }

      // Update bot state — lastPing, strategy, RSI values only, NOT position
      await db.botState.upsert({
        where: { id: 1 },
        create: {
          position: 'NEUTRAL',
          currentRSI: signalRSI,
          currentSMA: signalSMA,
          lastPing: new Date(),
          strategy: 'RSI',
        },
        update: {
          currentRSI: signalRSI,
          currentSMA: signalSMA,
          lastPing: new Date(),
          strategy: 'RSI',
        },
      });
    }

    engineState.lastDesiredAction = desiredAction;

    // ========================================
    // STEP 2: Auto-trade — compare desired vs current position
    // ========================================
    let tradeResultMsg = '';

    if (engineState.autoTrade && currentPrice > 0) {
      const config = {
        quantity: botConfig?.quantity ?? 0.002,
        leverage: botConfig?.leverage ?? 100,
        slPercent: botConfig?.stoplossPercent ?? 0.05,
        tpPercent: botConfig?.takeprofitPercent ?? 0.15,
      };

      console.log(`[Bot Engine] AUTO-TRADE: desired=${desiredAction} vs current=${currentPos} | strategy=${activeStrategy}`);

      if (desiredAction === currentPos) {
        // Already in correct position — no action needed
        tradeResultMsg = `Position correct (${desiredAction}) — holding`;
      } else if (desiredAction === 'NEUTRAL' && currentPos !== 'NEUTRAL') {
        // Strategy says close position
        console.log(`[Bot Engine] Closing ${currentPos} position (strategy says NEUTRAL)`);

        const closeResult = await closeMudrexPosition();

        if (closeResult.success) {
          tradeResultMsg = `Closed ${currentPos}${closeResult.positionId ? ` (pos:${closeResult.positionId.slice(0, 8)}...)` : ''} @ $${currentPrice.toFixed(2)}`;
          await db.botState.upsert({
            where: { id: 1 },
            create: { position: 'NEUTRAL' },
            update: { position: 'NEUTRAL' },
          });
          await db.tradeLog.create({
            data: {
              source: 'AUTO', orderType: currentPos === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT', price: currentPrice,
              quantity: config.quantity, leverage: config.leverage,
              slPrice: null, tpPrice: 0, slPercent: null, tpPercent: null,
              status: 'FILLED', result: `[${activeStrategy}] CLOSE ${currentPos} @ $${currentPrice.toFixed(2)}`,
            },
          });
        } else {
          tradeResultMsg = `Close ${currentPos} failed: ${closeResult.error}`;
        }
      } else if (desiredAction === 'LONG' || desiredAction === 'SHORT') {
        const orderType = desiredAction;
        const isBuy = orderType === 'LONG';

        // Calculate SL/TP
        const sl = isBuy
          ? currentPrice * (1 - config.slPercent / 100)
          : currentPrice * (1 + config.slPercent / 100);
        const tp = isBuy
          ? currentPrice * (1 + config.tpPercent / 100)
          : currentPrice * (1 - config.tpPercent / 100);

        // Close opposite position if we have one (using position_id API)
        if (currentPos !== 'NEUTRAL') {
          console.log(`[Bot Engine] Closing ${currentPos} before opening ${orderType}`);

          const closeResult = await closeMudrexPosition();

          if (closeResult.success) {
            tradeResultMsg += `Closed ${currentPos}; `;
            await db.botState.upsert({
              where: { id: 1 },
              create: { position: 'NEUTRAL' },
              update: { position: 'NEUTRAL' },
            });
            // Wait for close to settle before opening new position
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            tradeResultMsg += `Close ${currentPos} failed: ${closeResult.error}; `;
            console.error(`[Bot Engine] Close failed, skipping new order`);
            engineState.lastTradeResult = tradeResultMsg;
            return;
          }
        }

        // Place the new order
        console.log(`[Bot Engine] Placing ${orderType} @ $${currentPrice.toFixed(2)} SL=$${sl.toFixed(2)} TP=$${tp.toFixed(2)}`);

        const result = await placeMudrexOrder({
          order_type: orderType,
          order_price: currentPrice,
          quantity: config.quantity,
          leverage: config.leverage,
          stoploss_price: sl,
          takeprofit_price: tp,
        });

        if (result.success) {
          tradeResultMsg += `${orderType} @ $${currentPrice.toFixed(2)} SL=$${sl.toFixed(2)} TP=$${tp.toFixed(2)}`;
          engineState.lastTradedCandleTime = signalCandleTime;
          await db.botState.upsert({
            where: { id: 1 },
            create: { position: orderType },
            update: { position: orderType },
          });
          await db.tradeLog.create({
            data: {
              source: 'AUTO', orderType, price: currentPrice,
              quantity: config.quantity, leverage: config.leverage,
              slPrice: sl, tpPrice: tp, slPercent: config.slPercent, tpPercent: config.tpPercent,
              orderId: result.order_id || null, status: 'FILLED',
              result: `[${activeStrategy}] ${orderType} @ $${currentPrice.toFixed(2)} SL=$${sl.toFixed(2)} TP=$${tp.toFixed(2)}`,
            },
          });
          console.log(`[Bot Engine] TRADE SUCCESS: ${tradeResultMsg}`);
        } else {
          tradeResultMsg += `${orderType} FAILED: ${result.error}`;
          await db.tradeLog.create({
            data: {
              source: 'AUTO', orderType, price: currentPrice,
              quantity: config.quantity, leverage: config.leverage,
              slPrice: sl, tpPrice: tp, slPercent: config.slPercent, tpPercent: config.tpPercent,
              status: 'FAILED', result: result.error || 'Unknown error',
            },
          });
          console.error(`[Bot Engine] TRADE FAILED: ${tradeResultMsg}`);
        }
      }
      engineState.lastTradeResult = tradeResultMsg;
    } else if (!engineState.autoTrade) {
      engineState.lastTradeResult = 'Auto-trade OFF';
    }

    // Update lastPing
    await db.botState.upsert({
      where: { id: 1 },
      create: { lastPing: new Date(), strategy: activeStrategy },
      update: { lastPing: new Date() },
    });

    engineState.checkCount++;
    engineState.lastCheckAt = new Date().toISOString();
    engineState.lastResult = `${activeStrategy}: desired=${desiredAction} vs pos=${currentPos} | ${candleDirection || `RSI=${signalRSI.toFixed(1)} SMA=${signalSMA.toFixed(1)}`}`;
    engineState.errorCount = 0;
  } catch (error) {
    engineState.errorCount++;
    engineState.lastCheckAt = new Date().toISOString();
    const errMsg = error instanceof Error ? error.message : 'Unknown';
    engineState.lastResult = `ERROR: ${errMsg}`;
    console.error(`[Bot Engine] Check #${engineState.checkCount} failed:`, errMsg);
  } finally {
    engineState.isRunning = false;
  }
}

/**
 * Start the bot engine
 * CRITICAL FIX: Interval ALWAYS starts regardless of first-check success/failure
 */
export function startBotEngine(): void {
  if (intervalRef) {
    console.log('[Bot Engine] Already running, skipping duplicate start');
    return;
  }

  engineState.startedAt = new Date().toISOString();
  const initialDelay = 3000; // 3 seconds — fast startup
  engineState.nextCheckAt = new Date(Date.now() + initialDelay).toISOString();
  console.log(`[Bot Engine] Starting — first check in ${initialDelay / 1000}s, then CANDLE=30s / RSI=3min`);

  // ★ CRITICAL FIX: Start recurring interval IMMEDIATELY, not inside .then()
  // This ensures the bot keeps checking even if the first check fails
  intervalRef = setInterval(() => {
    runBotCheck();
    engineState.nextCheckAt = new Date(Date.now() + engineState.currentIntervalMs).toISOString();
  }, engineState.currentIntervalMs);
  console.log(`[Bot Engine] Recurring interval started (every ${engineState.currentIntervalMs / 1000}s)`);

  // First check after short delay (fire-and-forget, interval is already running)
  setTimeout(() => {
    runBotCheck();
  }, initialDelay);
}

/**
 * Get the current engine state (for /api/bot/status)
 */
export function getEngineState(): EngineState {
  return { ...engineState };
}

/**
 * Force a manual check (called by /api/bot/check when triggered manually)
 */
export async function forceCheck(): Promise<{ ok: boolean; state: ReturnType<typeof getCurrentState>; signals: any[] }> {
  const candles = await fetchKlines();
  const { rsiPoints, signals } = runStrategy(candles, RSI_LENGTH, SMA_LENGTH);
  const state = getCurrentState(candles, RSI_LENGTH, SMA_LENGTH);

  for (const signal of signals) {
    const exists = await db.signal.findFirst({
      where: { candleTime: signal.candleTime, type: signal.type },
    });
    if (!exists) {
      await db.signal.create({
        data: {
          type: signal.type,
          price: signal.price,
          rsi: signal.rsi,
          rsiSma: signal.rsiSma,
          candleTime: signal.candleTime,
        },
      });
    }
  }

  await db.botState.upsert({
    where: { id: 1 },
    create: {
      position: state.position,
      currentRSI: state.currentRSI ?? 0,
      currentSMA: state.currentSMA ?? 0,
      lastPing: new Date(),
    },
    update: {
      position: state.position,
      currentRSI: state.currentRSI ?? 0,
      currentSMA: state.currentSMA ?? 0,
      lastPing: new Date(),
    },
  });

  return { ok: true, state, signals };
}
