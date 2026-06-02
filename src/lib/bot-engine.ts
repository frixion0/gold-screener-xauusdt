// Self-Scheduling Bot Engine
// Runs RSI strategy checks autonomously every ~3 minutes (aligned with 3m candle closes)
// When autoTrade is ON, places real orders via Mudrex API

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

    const candles = await fetchKlines();
    const { signals } = runStrategy(candles, RSI_LENGTH, SMA_LENGTH);
    const state = getCurrentState(candles, RSI_LENGTH, SMA_LENGTH);
    const currentPrice = candles[candles.length - 1]?.close ?? 0;

    // Store new signals (avoid duplicates by candleTime + type)
    let newSignals: typeof signals = [];
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
        newSignals.push(signal);
      }
    }

    // Auto-trade: execute new signals via Mudrex
    let tradeResultMsg = '';
    if (engineState.autoTrade && newSignals.length > 0 && currentPrice > 0) {
      const config = {
        quantity: botConfig?.quantity ?? 0.002,
        leverage: botConfig?.leverage ?? 100,
        slPercent: botConfig?.stoplossPercent ?? 0.05,
        tpPercent: botConfig?.takeprofitPercent ?? 0.15,
      };

      for (const signal of newSignals) {
        const isBuy = signal.type === 'BUY';
        const sl = isBuy
          ? signal.price * (1 - config.slPercent / 100)
          : signal.price * (1 + config.slPercent / 100);
        const tp = isBuy
          ? signal.price * (1 + config.tpPercent / 100)
          : signal.price * (1 - config.tpPercent / 100);

        // If we have an opposite position, close it first
        if ((isBuy && state.position === 'SHORT') || (!isBuy && state.position === 'LONG')) {
          const closeType = isBuy ? 'LONG' : 'SHORT';
          const closeResult = await closeMudrexPosition({
            order_type: closeType,
            order_price: currentPrice,
            quantity: config.quantity,
            leverage: config.leverage,
          });
          if (!closeResult.success) {
            tradeResultMsg += `Close ${state.position} failed: ${closeResult.error}; `;
          } else {
            tradeResultMsg += `Closed ${state.position}; `;
            // Update position to NEUTRAL after close
            await db.botState.upsert({
              where: { id: 1 },
              create: { position: 'NEUTRAL', currentRSI: 0, currentSMA: 0 },
              update: { position: 'NEUTRAL' },
            });
          }
        }

        // Place the new order
        const orderType = isBuy ? 'LONG' : 'SHORT';
        const result = await placeMudrexOrder({
          order_type: orderType,
          order_price: currentPrice,
          quantity: config.quantity,
          leverage: config.leverage,
          stoploss_price: sl,
          takeprofit_price: tp,
        });

        if (result.success) {
          tradeResultMsg += `${signal.type} @ $${signal.price.toFixed(2)} (SL=$${sl.toFixed(2)}, TP=$${tp.toFixed(2)}) ✅`;
          // Update position
          const newPos = isBuy ? 'LONG' : 'SHORT';
          await db.botState.upsert({
            where: { id: 1 },
            create: { position: newPos, currentRSI: state.currentRSI ?? 0, currentSMA: state.currentSMA ?? 0 },
            update: { position: newPos },
          });
          // Log auto-trade to TradeLog
          await db.tradeLog.create({
            data: {
              source: 'AUTO',
              orderType, price: currentPrice, quantity: config.quantity, leverage: config.leverage,
              slPrice: sl, tpPrice: tp, slPercent: config.slPercent, tpPercent: config.tpPercent,
              orderId: result.order_id || null, status: 'FILLED',
              result: `${signal.type} @ $${signal.price.toFixed(2)} SL=$${sl.toFixed(2)} TP=$${tp.toFixed(2)}`,
            },
          });
        } else {
          tradeResultMsg += `${signal.type} failed: ${result.error}`;
          // Log failed auto-trade
          await db.tradeLog.create({
            data: {
              source: 'AUTO',
              orderType, price: currentPrice, quantity: config.quantity, leverage: config.leverage,
              slPrice: sl, tpPrice: tp, slPercent: config.slPercent, tpPercent: config.tpPercent,
              status: 'FAILED', result: result.error || 'Unknown error',
            },
          });
        }
      }
      engineState.lastTradeResult = tradeResultMsg;
    } else if (!engineState.autoTrade) {
      engineState.lastTradeResult = 'Auto-trade OFF';
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

    engineState.checkCount++;
    engineState.lastCheckAt = new Date().toISOString();
    engineState.lastResult = `OK — ${signals.length} signals (${newSignals.length} new), pos=${state.position}, RSI=${state.currentRSI?.toFixed(1)}, SMA=${state.currentSMA?.toFixed(1)}`;
    engineState.errorCount = 0;

    if (signals.length > 0) {
      const latest = signals[signals.length - 1];
      console.log(`[Bot Engine] ${latest.type} signal @ $${latest.price.toFixed(2)} (RSI=${latest.rsi.toFixed(1)}, SMA=${latest.rsiSma.toFixed(1)})`);
    }
  } catch (error) {
    engineState.errorCount++;
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
