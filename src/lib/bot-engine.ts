// Self-Scheduling Bot Engine
// Runs strategy checks autonomously every ~3 minutes (aligned with 3m candle closes)
// When autoTrade is ON, compares desired position with current position and trades accordingly

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

// Check every 3 minutes to align with candle closes
const CHECK_INTERVAL_MS = 3 * 60 * 1000;

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
  order_type: 'LONG' | 'SHORT'; // opposite of current position
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
  if (engineState.isRunning) return; // Skip if previous check is still running
  engineState.isRunning = true;

  try {
    // Read auto-trade config from DB
    const botConfig = await db.botState.findUnique({ where: { id: 1 } });
    engineState.autoTrade = botConfig?.autoTrade ?? false;
    const activeStrategy = botConfig?.strategy ?? 'RSI';

    const candles = await fetchKlines();
    if (candles.length < 20) {
      throw new Error(`Not enough candles: ${candles.length}`);
    }
    const currentPrice = candles[candles.length - 1]?.close ?? 0;
    // Use the PREVIOUS candle (already completed) for signal determination
    // The latest candle from Binance API is the currently forming one
    const checkCandle = candles.length > 1 ? candles[candles.length - 2] : candles[candles.length - 1];

    // ========================================
    // STEP 1: Determine desired position from strategy
    // ========================================
    let desiredAction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    let signalPrice = currentPrice;
    let signalRSI = 0;
    let signalSMA = 0;
    let signalCandleTime = checkCandle?.time ?? 0;

    if (activeStrategy === 'CANDLE') {
      // Strategy 2: Close > Open → LONG, Close < Open → SHORT
      if (checkCandle) {
        const isBullish = checkCandle.close > checkCandle.open;
        desiredAction = isBullish ? 'LONG' : 'SHORT';
        signalPrice = checkCandle.close;
        signalCandleTime = checkCandle.time;
        console.log(`[Bot Engine] CANDLE strategy: close=$${checkCandle.close.toFixed(2)} open=$${checkCandle.open.toFixed(2)} → ${desiredAction}`);
      }

      // Store CANDLE signal in DB (for logging) — check if this candle already has a signal
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

      // Update bot state with CANDLE strategy info
      await db.botState.upsert({
        where: { id: 1 },
        create: {
          position: desiredAction,
          currentRSI: 0,
          currentSMA: 0,
          lastPing: new Date(),
          strategy: 'CANDLE',
        },
        update: {
          position: desiredAction,
          currentRSI: 0,
          currentSMA: 0,
          lastPing: new Date(),
          strategy: 'CANDLE',
        },
      });
    } else {
      // Strategy 1: RSI(1) + SMA(14)
      const { signals } = runStrategy(candles, RSI_LENGTH, SMA_LENGTH);
      const state = getCurrentState(candles, RSI_LENGTH, SMA_LENGTH);

      // desiredAction from RSI state
      // getCurrentState returns LONG (after BUY) or NEUTRAL (after SELL or initial)
      desiredAction = state.position === 'LONG' ? 'LONG' : 'NEUTRAL';
      signalRSI = state.currentRSI ?? 0;
      signalSMA = state.currentSMA ?? 0;

      console.log(`[Bot Engine] RSI strategy: position=${state.position}, RSI=${signalRSI.toFixed(1)}, SMA=${signalSMA.toFixed(1)} → desired=${desiredAction}`);

      // Store RSI crossover signals in DB (for logging/history)
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
          console.log(`[Bot Engine] Stored RSI signal: ${signal.type} @ $${signal.price.toFixed(2)} (RSI=${signal.rsi.toFixed(1)}, SMA=${signal.rsiSma.toFixed(1)})`);
        }
      }

      // Update bot state with RSI values
      await db.botState.upsert({
        where: { id: 1 },
        create: {
          position: state.position,
          currentRSI: signalRSI,
          currentSMA: signalSMA,
          lastPing: new Date(),
          strategy: 'RSI',
        },
        update: {
          position: state.position,
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
    let currentPos = botConfig?.position || 'NEUTRAL';
    let tradeResultMsg = '';

    if (engineState.autoTrade && currentPrice > 0) {
      const config = {
        quantity: botConfig?.quantity ?? 0.002,
        leverage: botConfig?.leverage ?? 100,
        slPercent: botConfig?.stoplossPercent ?? 0.05,
        tpPercent: botConfig?.takeprofitPercent ?? 0.15,
      };

      console.log(`[Bot Engine] Auto-trade check: desired=${desiredAction}, current=${currentPos}, autoTrade=${engineState.autoTrade}`);

      if (desiredAction === currentPos) {
        // Already in correct position — no action needed
        tradeResultMsg = `Position correct (${desiredAction}) — no trade needed`;
        console.log(`[Bot Engine] ${tradeResultMsg}`);
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
          tradeResultMsg = `Closed ${currentPos} @ $${currentPrice.toFixed(2)} (strategy → NEUTRAL)`;
          currentPos = 'NEUTRAL';
          await db.botState.upsert({
            where: { id: 1 },
            create: { position: 'NEUTRAL', currentRSI: 0, currentSMA: 0 },
            update: { position: 'NEUTRAL' },
          });
          await db.tradeLog.create({
            data: {
              source: 'AUTO',
              orderType: closeType,
              price: currentPrice,
              quantity: config.quantity,
              leverage: config.leverage,
              slPrice: null,
              tpPrice: 0,
              slPercent: null,
              tpPercent: null,
              status: 'FILLED',
              result: `[${activeStrategy}] CLOSE ${currentPos} @ $${currentPrice.toFixed(2)}`,
            },
          });
          console.log(`[Bot Engine] ${tradeResultMsg}`);
        } else {
          tradeResultMsg = `Close ${currentPos} failed: ${closeResult.error}`;
          console.error(`[Bot Engine] ${tradeResultMsg}`);
        }
      } else {
        // desiredAction is LONG or SHORT, and it differs from currentPos
        const isBuy = desiredAction === 'LONG';
        const orderType = desiredAction;

        // Calculate SL/TP
        const sl = isBuy
          ? currentPrice * (1 - config.slPercent / 100)
          : currentPrice * (1 + config.slPercent / 100);
        const tp = isBuy
          ? currentPrice * (1 + config.tpPercent / 100)
          : currentPrice * (1 - config.tpPercent / 100);

        // Step 2a: Close opposite position if we have one
        if (currentPos !== 'NEUTRAL') {
          const closeType = currentPos === 'LONG' ? 'SHORT' : 'LONG';
          console.log(`[Bot Engine] Closing opposite ${currentPos} before opening ${desiredAction}`);

          const closeResult = await closeMudrexPosition({
            order_type: closeType,
            order_price: currentPrice,
            quantity: config.quantity,
            leverage: config.leverage,
          });

          if (closeResult.success) {
            tradeResultMsg += `Closed ${currentPos}; `;
            currentPos = 'NEUTRAL';
            await db.botState.upsert({
              where: { id: 1 },
              create: { position: 'NEUTRAL', currentRSI: 0, currentSMA: 0 },
              update: { position: 'NEUTRAL' },
            });
            // Small delay before opening new position
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            tradeResultMsg += `Close ${currentPos} failed: ${closeResult.error}; `;
            console.error(`[Bot Engine] Failed to close ${currentPos}, skipping new order`);
            // Don't open new position if close failed
            engineState.lastTradeResult = tradeResultMsg;
            engineState.checkCount++;
            engineState.lastCheckAt = new Date().toISOString();
            engineState.lastResult = `OK — pos=${currentPos}, desired=${desiredAction}, strategy=${activeStrategy} (close failed)`;
            return;
          }
        }

        // Step 2b: Place the new order
        console.log(`[Bot Engine] Placing ${orderType} order @ $${currentPrice.toFixed(2)} (SL=$${sl.toFixed(2)}, TP=$${tp.toFixed(2)})`);

        const result = await placeMudrexOrder({
          order_type: orderType,
          order_price: currentPrice,
          quantity: config.quantity,
          leverage: config.leverage,
          stoploss_price: sl,
          takeprofit_price: tp,
        });

        if (result.success) {
          tradeResultMsg += `${orderType} @ $${currentPrice.toFixed(2)} (SL=$${sl.toFixed(2)}, TP=$${tp.toFixed(2)})`;
          currentPos = orderType;
          await db.botState.upsert({
            where: { id: 1 },
            create: { position: currentPos, currentRSI: 0, currentSMA: 0 },
            update: { position: currentPos },
          });
          // Log auto-trade to TradeLog
          await db.tradeLog.create({
            data: {
              source: 'AUTO',
              orderType,
              price: currentPrice,
              quantity: config.quantity,
              leverage: config.leverage,
              slPrice: sl,
              tpPrice: tp,
              slPercent: config.slPercent,
              tpPercent: config.tpPercent,
              orderId: result.order_id || null,
              status: 'FILLED',
              result: `[${activeStrategy}] ${orderType} @ $${currentPrice.toFixed(2)} SL=$${sl.toFixed(2)} TP=$${tp.toFixed(2)}`,
            },
          });
          console.log(`[Bot Engine] Trade placed successfully: ${tradeResultMsg}`);
        } else {
          tradeResultMsg += `${orderType} failed: ${result.error}`;
          await db.tradeLog.create({
            data: {
              source: 'AUTO',
              orderType,
              price: currentPrice,
              quantity: config.quantity,
              leverage: config.leverage,
              slPrice: sl,
              tpPrice: tp,
              slPercent: config.slPercent,
              tpPercent: config.tpPercent,
              status: 'FAILED',
              result: result.error || 'Unknown error',
            },
          });
          console.error(`[Bot Engine] Trade failed: ${tradeResultMsg}`);
        }
      }
      engineState.lastTradeResult = tradeResultMsg;
    } else if (!engineState.autoTrade) {
      engineState.lastTradeResult = 'Auto-trade OFF';
    } else {
      engineState.lastTradeResult = 'No price data';
    }

    // Update lastPing
    await db.botState.upsert({
      where: { id: 1 },
      create: { lastPing: new Date(), strategy: activeStrategy },
      update: { lastPing: new Date(), strategy: activeStrategy },
    });

    engineState.checkCount++;
    engineState.lastCheckAt = new Date().toISOString();
    engineState.lastResult = `OK — pos=${currentPos}, desired=${desiredAction}, strategy=${activeStrategy}`;
    engineState.errorCount = 0;

    console.log(`[Bot Engine] Check #${engineState.checkCount} complete: ${engineState.lastResult}`);
  } catch (error) {
    engineState.errorCount++;
    engineState.lastCheckAt = new Date().toISOString();
    engineState.lastResult = `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`;
    console.error(`[Bot Engine] Check #${engineState.checkCount} failed:`, error);
  } finally {
    engineState.isRunning = false;
  }
}

// Align first check to the nearest 3-minute candle boundary
function getMsToNextCandle(): number {
  const now = Date.now();
  const threeMin = 3 * 60 * 1000;
  const msIntoCandle = now % threeMin;
  // Wait until the candle closes plus a 5-second buffer for data availability
  return msIntoCandle === 0 ? 5000 : (threeMin - msIntoCandle + 5000);
}

/**
 * Start the bot engine — sets up recurring checks every 3 minutes
 * Aligned to candle close times for accurate signal detection
 */
export function startBotEngine(): void {
  if (intervalRef) {
    console.log('[Bot Engine] Already running, skipping duplicate start');
    return;
  }

  engineState.startedAt = new Date().toISOString();
  engineState.nextCheckAt = new Date(Date.now() + getMsToNextCandle()).toISOString();
  console.log(`[Bot Engine] Starting — first check in ~${Math.round(getMsToNextCandle() / 1000)}s (aligned to candle close), then every ${CHECK_INTERVAL_MS / 1000}s`);

  // Initial check immediately (slight delay to let server warm up)
  setTimeout(() => {
    runBotCheck().then(() => {
      engineState.nextCheckAt = new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
      // Schedule recurring checks aligned to 3-min intervals
      intervalRef = setInterval(() => {
        runBotCheck();
        engineState.nextCheckAt = new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
      }, CHECK_INTERVAL_MS);
      console.log('[Bot Engine] Recurring checks started (every 3 minutes)');
    });
  }, 2000);
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

  // Store new signals
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

  // Update bot state
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
