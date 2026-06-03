// Self-Scheduling Bot Engine
// RSI strategy: checks every 3 minutes (aligned to candle closes)
// CANDLE strategy: checks every 30 seconds (fast response to direction changes)

import { db } from './db';
import { runStrategy, getCurrentState } from './rsi';

const BINANCE_FUTURES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const PROXY_URL = 'https://api.allorigins.win/raw?url=';
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
};

let intervalRef: ReturnType<typeof setInterval> | null = null;

async function fetchKlines(): Promise<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]> {
  const url = `${BINANCE_FUTURES_URL}?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${LIMIT}`;

  // Try direct fetch first
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
  } catch {
    // Direct fetch failed (IP blocked on cloud hosts), try proxy
  }

  // Fallback: use CORS proxy
  try {
    const proxyUrl = `${PROXY_URL}${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
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
  } catch {
    // Proxy also failed
  }

  throw new Error('Failed to fetch kline data from Binance (direct + proxy)');
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
 * Close existing position via Mudrex reduce_only order
 */
async function closeMudrexPosition(params: {
  order_type: 'LONG' | 'SHORT';
  order_price: number;
  quantity: number;
  leverage: number;
}): Promise<{ success: boolean; error?: string }> {
  if (!SECRET_KEY) return { success: false, error: 'Mudrex API key not configured' };

  const orderBody = {
    leverage: params.leverage,
    quantity: params.quantity,
    order_price: Math.round(params.order_price),
    order_type: params.order_type,
    trigger_type: 'MARKET',
    is_takeprofit: false,
    is_stoploss: false,
    reduce_only: true,
  };

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
      console.log(`[Mudrex] Position closed: order_id=${json.data?.order_id}`);
      return { success: true };
    } else {
      const errMsg = json.message || `API error: ${res.status}`;
      console.error(`[Mudrex] Close failed: ${errMsg}`, json);
      return { success: false, error: errMsg };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Mudrex] Close error: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

async function runBotCheck(): Promise<void> {
  if (engineState.isRunning) return;
  engineState.isRunning = true;

  try {
    // Read config from DB — this is the SNAPSHOT before any strategy updates
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

    // For CANDLE strategy: use the LATEST candle (currently forming) for immediate response
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
      // Strategy 2: Use the CURRENT forming candle
      // If close > open (green) → LONG, if close < open (red) → SHORT
      if (latestCandle) {
        const isBullish = latestCandle.close > latestCandle.open;
        const isDoji = Math.abs(latestCandle.close - latestCandle.open) < 0.01;
        desiredAction = isDoji ? currentPos as 'LONG' | 'SHORT' | 'NEUTRAL' : (isBullish ? 'LONG' : 'SHORT');
        signalPrice = latestCandle.close;
        signalCandleTime = latestCandle.time;
        candleDirection = isBullish ? 'GREEN (close>open)' : isDoji ? 'DOJI' : 'RED (close<open)';

        console.log(`[Bot Engine] CANDLE: ${candleDirection} | close=$${latestCandle.close.toFixed(2)} open=$${latestCandle.open.toFixed(2)} → desired=${desiredAction}`);
      }

      // Store signal in DB only once per candle (dedup by candleTime)
      if (signalCandleTime > 0 && signalCandleTime !== engineState.lastTradedCandleTime) {
        const existingSignal = await db.signal.findFirst({
          where: { candleTime: signalCandleTime, type: { startsWith: '[S2]' } },
        });
        if (!existingSignal) {
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

      // Update bot state — ONLY the lastPing and strategy, NOT position
      // Position is updated ONLY after successful trades to avoid sync issues
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

      // Update bot state — ONLY lastPing, strategy, and RSI values, NOT position
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
        const closeType = currentPos === 'LONG' ? 'SHORT' : 'LONG';
        console.log(`[Bot Engine] Closing ${currentPos} position (strategy says NEUTRAL)`);

        const closeResult = await closeMudrexPosition({
          order_type: closeType,
          order_price: currentPrice,
          quantity: config.quantity,
          leverage: config.leverage,
        });

        if (closeResult.success) {
          tradeResultMsg = `Closed ${currentPos} @ $${currentPrice.toFixed(2)}`;
          await db.botState.upsert({
            where: { id: 1 },
            create: { position: 'NEUTRAL' },
            update: { position: 'NEUTRAL' },
          });
          await db.tradeLog.create({
            data: {
              source: 'AUTO', orderType: closeType, price: currentPrice,
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

        // Close opposite position if we have one
        if (currentPos !== 'NEUTRAL') {
          const closeType = currentPos === 'LONG' ? 'SHORT' : 'LONG';
          console.log(`[Bot Engine] Closing ${currentPos} before opening ${orderType}`);

          const closeResult = await closeMudrexPosition({
            order_type: closeType,
            order_price: currentPrice,
            quantity: config.quantity,
            leverage: config.leverage,
          });

          if (closeResult.success) {
            tradeResultMsg += `Closed ${currentPos}; `;
            await db.botState.upsert({
              where: { id: 1 },
              create: { position: 'NEUTRAL' },
              update: { position: 'NEUTRAL' },
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
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
    engineState.lastResult = `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`;
    console.error(`[Bot Engine] Check #${engineState.checkCount} failed:`, error);
  } finally {
    engineState.isRunning = false;
  }
}

/**
 * Start the bot engine — first check in 3 seconds, then recurring
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

  // First check after short delay
  setTimeout(() => {
    runBotCheck().then(() => {
      // Start recurring checks
      intervalRef = setInterval(() => {
        runBotCheck();
        engineState.nextCheckAt = new Date(Date.now() + engineState.currentIntervalMs).toISOString();
      }, engineState.currentIntervalMs);
      console.log(`[Bot Engine] Recurring checks started (every ${engineState.currentIntervalMs / 1000}s)`);
    });
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
