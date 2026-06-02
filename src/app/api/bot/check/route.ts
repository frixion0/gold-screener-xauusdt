import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runStrategy, getCurrentState } from '@/lib/rsi';

const BINANCE_FUTURES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const PROXY_URL = 'https://api.allorigins.win/raw?url=';
const SYMBOL = 'XAUUSDT';
const INTERVAL = '3m';
const LIMIT = 200;
const RSI_LENGTH = 1;
const SMA_LENGTH = 14;

async function fetchKlines(): Promise<{ time: number; close: number }[]> {
  const url = `${BINANCE_FUTURES_URL}?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${LIMIT}`;

  // Try direct fetch first
  let response: Response | null = null;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) });
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
    response = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
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

  throw new Error('Failed to fetch kline data from Binance');
}

export async function GET() {
  const startTime = Date.now();

  try {
    const candles = await fetchKlines();
    const { rsiPoints, signals } = runStrategy(candles, RSI_LENGTH, SMA_LENGTH);
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

    const recentSignals = await db.signal.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      ok: true,
      latency: Date.now() - startTime,
      state: {
        currentRSI: state.currentRSI,
        currentSMA: state.currentSMA,
        position: state.position,
        candlesLoaded: candles.length,
      },
      newSignalsCount: signals.length,
      totalSignals: recentSignals.length,
      latestSignal: signals.length > 0 ? signals[signals.length - 1] : null,
      recentSignals,
    });
  } catch (error) {
    console.error('Bot check error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
