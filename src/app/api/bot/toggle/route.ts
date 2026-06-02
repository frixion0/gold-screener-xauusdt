import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/bot/toggle
// Body: { autoTrade: boolean, quantity?: number, leverage?: number, stoplossPercent?: number, takeprofitPercent?: number }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { autoTrade, quantity, leverage, stoplossPercent, takeprofitPercent } = body;

    if (typeof autoTrade !== 'boolean') {
      return NextResponse.json({ error: 'autoTrade must be true or false' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { autoTrade };
    if (quantity !== undefined) updateData.quantity = Number(quantity);
    if (leverage !== undefined) updateData.leverage = Number(leverage);
    if (stoplossPercent !== undefined) updateData.stoplossPercent = Number(stoplossPercent);
    if (takeprofitPercent !== undefined) updateData.takeprofitPercent = Number(takeprofitPercent);

    const botState = await db.botState.upsert({
      where: { id: 1 },
      create: {
        position: 'NEUTRAL',
        currentRSI: 0,
        currentSMA: 0,
        autoTrade: Boolean(autoTrade),
        quantity: Number(quantity) || 0.002,
        leverage: Number(leverage) || 100,
        stoplossPercent: Number(stoplossPercent) || 1,
        takeprofitPercent: Number(takeprofitPercent) || 2,
      },
      update: updateData,
    });

    return NextResponse.json({
      success: true,
      autoTrade: botState.autoTrade,
      quantity: botState.quantity,
      leverage: botState.leverage,
      stoplossPercent: botState.stoplossPercent,
      takeprofitPercent: botState.takeprofitPercent,
    });
  } catch (error) {
    console.error('[Bot Toggle] Error:', error);
    return NextResponse.json({ error: 'Failed to toggle bot' }, { status: 500 });
  }
}
