import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runStrategy, getCurrentState } from '@/lib/rsi';

// POST /api/bot/test-signal
// Accepts client-side kline data (avoids Binance IP blocking on cloud)
// Body: { candles: [{ time, open, high, low, close, volume }] }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const candles = body.candles;

    if (!candles || !Array.isArray(candles) || candles.length < 50) {
      return NextResponse.json({
        success: false,
        error: 'Need at least 50 candles. Send kline data in body.candles',
      }, { status: 400 });
    }

    // Run the strategy on client-provided data
    const { signals, rsiPoints } = runStrategy(candles, 1, 14);
    const state = getCurrentState(candles, 1, 14);
    const latestPrice = candles[candles.length - 1]?.close ?? 0;
    const latestRSI = rsiPoints.length > 0 ? rsiPoints[rsiPoints.length - 1] : null;

    // Generate test signal
    const testSignal = signals.length > 0
      ? signals[signals.length - 1]
      : {
          type: state.position === 'LONG' ? 'BUY' : state.position === 'SHORT' ? 'SELL' : (latestRSI && latestRSI.rsi < 50 ? 'BUY' : 'SELL'),
          price: latestPrice,
          rsi: state.currentRSI ?? 0,
          rsiSma: state.currentSMA ?? 0,
          candleTime: Math.floor(Date.now() / 1000),
        };

    // Save test signal to DB
    const saved = await db.signal.create({
      data: {
        type: `[TEST] ${testSignal.type}`,
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
      message: `[TEST] ${testSignal.type} @ $${testSignal.price.toFixed(2)} | RSI=${state.currentRSI?.toFixed(1)} SMA=${state.currentSMA?.toFixed(1)} | Pos=${state.position}`,
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
