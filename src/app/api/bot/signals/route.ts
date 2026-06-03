import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  try {
    const signals = await db.signal.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Calculate basic stats
    const buys = signals.filter((s) => s.type === 'BUY');
    const sells = signals.filter((s) => s.type === 'SELL');

    // Calculate P&L from paired trades
    let totalPnL = 0;
    let winCount = 0;
    let lossCount = 0;
    const buySignals = signals.filter((s) => s.type === 'BUY').reverse();
    const sellSignals = signals.filter((s) => s.type === 'SELL').reverse();

    for (const buy of buySignals) {
      const nextSell = sellSignals.find((s) => s.candleTime > buy.candleTime);
      if (nextSell) {
        const pnl = nextSell.price - buy.price;
        totalPnL += pnl;
        if (pnl > 0) winCount++;
        else lossCount++;
      }
    }

    return NextResponse.json({
      signals,
      stats: {
        totalSignals: signals.length,
        totalBuys: buys.length,
        totalSells: sells.length,
        totalPnL: Math.round(totalPnL * 100) / 100,
        winCount,
        lossCount,
        winRate: winCount + lossCount > 0
          ? Math.round((winCount / (winCount + lossCount)) * 100)
          : 0,
      },
    });
  } catch (error) {
    console.error('Signals fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch signals' },
      { status: 500 }
    );
  }
}
