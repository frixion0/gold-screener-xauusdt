import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/bot/trades?limit=2&source=AUTO
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '2');
    const source = searchParams.get('source'); // AUTO or MANUAL or undefined (all)

    const where: Record<string, unknown> = {};
    if (source) where.source = source;

    const trades = await db.tradeLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ success: true, trades });
  } catch (error) {
    console.error('[Trade Log] Fetch error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch trades' }, { status: 500 });
  }
}

// POST /api/bot/trades — Log a trade (called internally by bot-engine and order routes)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      source = 'MANUAL',
      orderType,
      price,
      quantity,
      leverage,
      slPrice,
      tpPrice,
      slPercent,
      tpPercent,
      orderId,
      status = 'FILLED',
      result,
    } = body;

    if (!orderType || !price) {
      return NextResponse.json({ error: 'orderType and price required' }, { status: 400 });
    }

    const trade = await db.tradeLog.create({
      data: {
        source: String(source),
        orderType: String(orderType),
        price: Number(price),
        quantity: Number(quantity) || 0.002,
        leverage: Number(leverage) || 100,
        slPrice: slPrice !== undefined ? Number(slPrice) : null,
        tpPrice: tpPrice !== undefined ? Number(tpPrice) : 0,
        slPercent: slPercent !== undefined ? Number(slPercent) : null,
        tpPercent: tpPercent !== undefined ? Number(tpPercent) : null,
        orderId: orderId ? String(orderId) : null,
        status: String(status),
        result: result ? String(result) : null,
      },
    });

    return NextResponse.json({ success: true, trade });
  } catch (error) {
    console.error('[Trade Log] Create error:', error);
    return NextResponse.json({ success: false, error: 'Failed to log trade' }, { status: 500 });
  }
}
