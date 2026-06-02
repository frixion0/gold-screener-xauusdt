// Self-Scheduling Bot Engine
// Runs RSI strategy checks autonomously every ~3 minutes (aligned with 3m candle closes)
// UptimeRobot pings just keep the Render server awake — the bot runs independently

import { db } from './db';
import { runStrategy, getCurrentState } from './rsi';

const BINANCE_FUTURES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const PROXY_URL = 'https://api.allorigins.win/raw?url=';
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
  checkCount: number;
  errorCount: number;
}

const engineState: EngineState = {
  isRunning: false,
  startedAt: null,
  lastCheckAt: null,
  nextCheckAt: null,
  lastResult: null,
  checkCount: 0,
  errorCount: 0,
};

let intervalRef: ReturnType<typeof setInterval> | null = null;

async function fetchKlines(): Promise<{ time: number; close: number }[]> {
  const url = `${BINANCE_FUTURES_URL}?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${LIMIT}`;

  // Try direct fetch first
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const data = await response.json();
      return data.map((k: (string | number)[]) => ({
        time: Math.floor(Number(k[0]) / 1000),
        close: parseFloat(String(k[4])),
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
        close: parseFloat(String(k[4])),
      }));
    }
  } catch {
    // Proxy also failed
  }

  throw new Error('Failed to fetch kline data from Binance (direct + proxy)');
}

async function runBotCheck(): Promise<void> {
  if (engineState.isRunning) return; // Skip if previous check is still running
  engineState.isRunning = true;

  try {
    const candles = await fetchKlines();
    const { signals } = runStrategy(candles, RSI_LENGTH, SMA_LENGTH);
    const state = getCurrentState(candles, RSI_LENGTH, SMA_LENGTH);

    // Store new signals (avoid duplicates by candleTime + type)
    for (const signal of signals) {
      const exists = await db.signal.findFirst({
        where: {
          candleTime: signal.candleTime,
          type: signal.type,
        },
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

    engineState.checkCount++;
    engineState.lastCheckAt = new Date().toISOString();
    engineState.lastResult = `OK — ${signals.length} signals, pos=${state.position}, RSI=${state.currentRSI?.toFixed(1)}, SMA=${state.currentSMA?.toFixed(1)}, candles=${candles.length}`;
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
