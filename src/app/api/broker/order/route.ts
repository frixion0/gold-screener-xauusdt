import { NextResponse } from 'next/server';

const MUDREX_API = 'https://trade.mudrex.com/fapi/v1/futures';
const SECRET_KEY = process.env.MUDREX_SECRET_KEY;

export async function POST(request: Request) {
  try {
    if (!SECRET_KEY) {
      return NextResponse.json({ error: 'Mudrex API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const {
      order_type,
      quantity = 0.002,
      leverage = 100,
      trigger_type = 'MARKET',
      stoploss_price,
      takeprofit_price,
      is_stoploss = false,
      is_takeprofit = false,
      order_price,
      symbol = 'XAUUSDT',
    } = body;

    if (!order_type || !['LONG', 'SHORT'].includes(order_type)) {
      return NextResponse.json({ error: 'order_type must be LONG or SHORT' }, { status: 400 });
    }

    if (!order_price || order_price <= 0) {
      return NextResponse.json({ error: 'order_price is required and must be positive' }, { status: 400 });
    }

    if (is_stoploss && (!stoploss_price || stoploss_price <= 0)) {
      return NextResponse.json({ error: 'stoploss_price required when is_stoploss is true' }, { status: 400 });
    }

    if (is_takeprofit && (!takeprofit_price || takeprofit_price <= 0)) {
      return NextResponse.json({ error: 'takeprofit_price required when is_takeprofit is true' }, { status: 400 });
    }

    const orderBody: Record<string, unknown> = {
      leverage: Number(leverage),
      quantity: Number(quantity),
      order_price: Number(Math.round(order_price)),
      order_type,
      trigger_type,
      is_takeprofit: Boolean(is_takeprofit),
      is_stoploss: Boolean(is_stoploss),
      reduce_only: false,
    };

    if (is_stoploss) orderBody.stoploss_price = Number(Math.round(stoploss_price));
    if (is_takeprofit) orderBody.takeprofit_price = Number(Math.round(takeprofit_price));

    const url = `${MUDREX_API}/${symbol}/order?is_symbol`;
    console.log(`[Mudrex] Placing ${order_type} order: ${JSON.stringify(orderBody)}`);

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
      console.error(`[Mudrex] Order failed:`, json);
      return NextResponse.json({
        success: false,
        error: json.message || `Mudrex API error: ${res.status}`,
        details: json,
      }, { status: res.ok ? 400 : res.status });
    }

    console.log(`[Mudrex] Order placed: ${json.data?.order_id}`);
    return NextResponse.json(json);
  } catch (err) {
    console.error('[Mudrex] Order error:', err);
    return NextResponse.json({ error: 'Failed to place order', details: String(err) }, { status: 500 });
  }
}
