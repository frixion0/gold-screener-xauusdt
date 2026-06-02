import { NextResponse } from 'next/server';

const MUDREX_API = 'https://trade.mudrex.com/fapi/v1/futures';
const SECRET_KEY = process.env.MUDREX_SECRET_KEY;

export async function POST(request: Request) {
  try {
    if (!SECRET_KEY) {
      return NextResponse.json({ error: 'Mudrex API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { order_type, quantity = 0.002, leverage = 100, order_price, symbol = 'XAUUSDT' } = body;

    if (!order_type || !['LONG', 'SHORT'].includes(order_type)) {
      return NextResponse.json({ error: 'order_type must be LONG or SHORT (opposite of position to close)' }, { status: 400 });
    }

    if (!order_price || order_price <= 0) {
      return NextResponse.json({ error: 'order_price is required' }, { status: 400 });
    }

    // reduce_only order with opposite type to close existing position
    const url = `${MUDREX_API}/${symbol}/order?is_symbol`;
    const orderBody = {
      leverage: Number(leverage),
      quantity: Number(quantity),
      order_price: Number(Math.round(order_price)),
      order_type,
      trigger_type: 'MARKET',
      is_takeprofit: false,
      is_stoploss: false,
      reduce_only: true,
    };

    console.log(`[Mudrex] Closing position with reduce_only order: ${JSON.stringify(orderBody)}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Authentication': SECRET_KEY,
      },
      body: JSON.stringify(orderBody),
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      console.error(`[Mudrex] Close failed:`, json);
      return NextResponse.json({
        success: false,
        error: json.message || `Mudrex API error: ${res.status}`,
        details: json,
      }, { status: res.ok ? 400 : res.status });
    }

    console.log(`[Mudrex] Position closed: ${json.data?.order_id}`);
    return NextResponse.json(json);
  } catch (err) {
    console.error('[Mudrex] Close error:', err);
    return NextResponse.json({ error: 'Failed to close position', details: String(err) }, { status: 500 });
  }
}
