import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runStrategy, getCurrentState } from '@/lib/rsi';

const BINANCE_FUTURES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const PROXY_URL = 'https://api.allorigins.win/raw?url=';

async function fetchKlines() {
  const url = `${BINANCE_FUTURES_URL}?symbol=XAUUSDT&interval=3m&limit=200`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
    // fallback to proxy
  }

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

  throw new Error('Failed to fetch kline data');
}

// POST /api/bot/test-signal
// Generates a test signal using the current strategy and saves it to DB
export async function POST() {
  try {
    const candles = await fetchKlines();
    const { signals, rsiPoints } = runStrategy(candles, 1, 14);
    const state = getCurrentState(candles, 1, 14);
    const latestPrice = candles[candles.length - 1]?.close ?? 0;
    const latestRSI = rsiPoints.length > 0 ? rsiPoints[rsiPoints.length - 1] : null;

    // Generate a test signal based on current state
    // If the strategy generates a signal, use it; otherwise create a synthetic one
    const testSignal = signals.length > 0
      ? signals[signals.length - 1]
      : {
          type: state.position === 'LONG' ? 'BUY' : state.position === 'SHORT' ? 'SELL' : (latestRSI && latestRSI.rsi < 50 ? 'BUY' : 'SELL'),
          price: latestPrice,
          rsi: state.currentRSI ?? 0,
          rsiSma: state.currentSMA ?? 0,
          candleTime: Math.floor(Date.now() / 1000),
        };

    // Mark it as a test signal by adding a note
    const saved = await db.signal.create({
      data: {
        type: `[TEST] ${testSignal.type}` as any,
        price: testSignal.price,
        rsi: testSignal.rsi,
        rsiSma: testSignal.rsiSma,
        candleTime: testSignal.candleTime,
      },
    });

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

    return NextResponse.json({
      success: true,
      message: `Test signal generated: [TEST] ${testSignal.type} @ $${testSignal.price.toFixed(2)} (RSI=${state.currentRSI?.toFixed(1)}, SMA=${state.currentSMA?.toFixed(1)}, Position=${state.position})`,
      signal: saved,
      state: {
        position: state.position,
        currentRSI: state.currentRSI,
        currentSMA: state.currentSMA,
      },
      strategySignals: signals.length,
      price: latestPrice,
    });
  } catch (error) {
    console.error('[Test Signal] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate test signal',
    }, { status: 500 });
  }
}
