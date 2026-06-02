import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    let botState = await db.botState.findUnique({ where: { id: 1 } });
    const totalSignals = await db.signal.count();

    if (!botState) {
      return NextResponse.json({
        active: false,
        position: 'NEUTRAL',
        currentRSI: null,
        currentSMA: null,
        lastPing: null,
        totalSignals,
      });
    }

    // Check if bot was pinged recently (within 2 minutes = alive)
    const lastPingAgo = Date.now() - botState.lastPing.getTime();
    const isActive = lastPingAgo < 120000;

    return NextResponse.json({
      active: isActive,
      position: botState.position,
      currentRSI: botState.currentRSI,
      currentSMA: botState.currentSMA,
      lastPing: botState.lastPing.toISOString(),
      lastPingAgoMs: lastPingAgo,
      totalSignals,
    });
  } catch (error) {
    console.error('Bot status error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bot status' },
      { status: 500 }
    );
  }
}
