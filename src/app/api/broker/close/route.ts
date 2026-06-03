import { NextResponse } from 'next/server';

const MUDREX_API = 'https://trade.mudrex.com/fapi/v1/futures';
const SECRET_KEY = 'v33dnrb92FKBSMTVUxJ6ufeW7cBBEmmK';

/**
 * Close a position using the dedicated Mudrex position_id close API.
 * POST /api/broker/close
 *
 * Body can be:
 *   { position_id: "uuid" }  — close by specific position_id
 *   { symbol: "XAUUSDT" }    — fetch open positions and close the matching one
 *   {}                       — close any open XAUUSDT position
 */
export async function POST(request: Request) {
  try {
    if (!SECRET_KEY) {
      return NextResponse.json({ error: 'Mudrex API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { position_id, symbol = 'XAUUSDT' } = body;

    // If position_id provided, close directly
    if (position_id) {
      console.log(`[Mudrex] Closing position_id=${position_id}`);
      const res = await fetch(`${MUDREX_API}/positions/${position_id}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Authentication': SECRET_KEY,
        },
      });

      const json = await res.json();

      if (json.success) {
        console.log(`[Mudrex] Position closed: position_id=${json.data?.position_id}`);
        return NextResponse.json(json);
      } else {
        console.error(`[Mudrex] Close failed:`, json);
        return NextResponse.json({
          success: false,
          error: json.message || `Mudrex API error: ${res.status}`,
          details: json,
        }, { status: res.ok ? 400 : res.status });
      }
    }

    // Otherwise: fetch open positions, find the matching one, close it
    console.log(`[Mudrex] Fetching positions to close ${symbol}...`);

    const posRes = await fetch(`${MUDREX_API}/positions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Authentication': SECRET_KEY,
      },
    });

    if (!posRes.ok) {
      const text = await posRes.text();
      return NextResponse.json({ error: `Fetch positions failed: ${posRes.status}`, details: text }, { status: posRes.status });
    }

    const posJson = await posRes.json();
    const positions: Array<{ id: string; symbol: string; order_type: string; status: string }> = posJson.data || [];

    // Find the position for the symbol
    const targetPosition = positions.find(
      (p) => p.symbol === symbol && (p.status === 'OPEN' || p.status === 'ACTIVE')
    );

    if (!targetPosition) {
      return NextResponse.json({
        success: false,
        error: `No open ${symbol} position found`,
        existingPositions: positions.map(p => ({ id: p.id, symbol: p.symbol, type: p.order_type, status: p.status })),
      });
    }

    console.log(`[Mudrex] Found position: id=${targetPosition.id}, type=${targetPosition.order_type}`);

    // Close using dedicated position_id endpoint
    const closeRes = await fetch(`${MUDREX_API}/positions/${targetPosition.id}/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Authentication': SECRET_KEY,
      },
    });

    const closeJson = await closeRes.json();

    if (closeJson.success) {
      console.log(`[Mudrex] Position closed: position_id=${closeJson.data?.position_id}`);
      return NextResponse.json({
        success: true,
        data: {
          ...closeJson.data,
          closed_position_type: targetPosition.order_type,
          closed_symbol: targetPosition.symbol,
        },
      });
    } else {
      console.error(`[Mudrex] Close failed:`, closeJson);
      return NextResponse.json({
        success: false,
        error: closeJson.message || `Mudrex API error: ${closeRes.status}`,
        details: closeJson,
      }, { status: closeRes.ok ? 400 : closeRes.status });
    }
  } catch (err) {
    console.error('[Mudrex] Close error:', err);
    return NextResponse.json({ error: 'Failed to close position', details: String(err) }, { status: 500 });
  }
}
