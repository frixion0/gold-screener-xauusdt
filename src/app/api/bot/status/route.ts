import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEngineState } from '@/lib/bot-engine';

export async function GET() {
  try {
    let botState = await db.botState.findUnique({ where: { id: 1 } });
    const totalSignals = await db.signal.count();
    const engine = getEngineState();

    if (!botState) {
      return NextResponse.json({
        active: engine.startedAt !== null,
        position: 'NEUTRAL',
        currentRSI: null,
        currentSMA: null,
        lastPing: null,
        totalSignals,
        autoTrade: false,
        quantity: 0.002,
        leverage: 100,
        stoplossPercent: 0.05,
        takeprofitPercent: 0.15,
        strategy: 'RSI',
        engine,
      });
    }

    // Engine is active if it has been started
    const isActive = engine.startedAt !== null;
    const lastPingAgo = botState.lastPing ? Date.now() - botState.lastPing.getTime() : 0;

    return NextResponse.json({
      active: isActive,
      position: botState.position,
      currentRSI: botState.currentRSI,
      currentSMA: botState.currentSMA,
      lastPing: botState.lastPing?.toISOString() ?? null,
      lastPingAgoMs: lastPingAgo,
      totalSignals,
      autoTrade: botState.autoTrade,
      quantity: botState.quantity,
      leverage: botState.leverage,
      stoplossPercent: botState.stoplossPercent,
      takeprofitPercent: botState.takeprofitPercent,
      strategy: botState.strategy,
      engine: {
        startedAt: engine.startedAt,
        lastCheckAt: engine.lastCheckAt,
        nextCheckAt: engine.nextCheckAt,
        lastResult: engine.lastResult,
        lastTradeResult: engine.lastTradeResult,
        lastDesiredAction: engine.lastDesiredAction,
        checkCount: engine.checkCount,
        errorCount: engine.errorCount,
        isRunning: engine.isRunning,
        autoTrade: engine.autoTrade,
        currentIntervalMs: engine.currentIntervalMs,
        lastTradedCandleTime: engine.lastTradedCandleTime,
        lastFetchError: engine.lastFetchError,
        relayFreshnessMs: engine.relayFreshnessMs,
      },
    });
  } catch (error) {
    console.error('Bot status error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bot status' },
      { status: 500 },
    );
  }
}
